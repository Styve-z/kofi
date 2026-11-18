import { and, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { assignableRoles, canManageAccount, ROLE_LABELS, type Role } from "@shared/permissions";
import { auditLogs, bookingEvents, bookings, professionalProfiles, promotions, serviceCatalog, users } from "../../drizzle/schema";
import type { Database } from "../db";
import { buildViews, type BookingStatus, type BookingView } from "./booking";
import { BusinessError } from "./errors";
import { notify, notifyCustomerOfStatus, notifyProfessional } from "./notifications";
import { onBookingClosed, onBookingCompleted, onBookingConfirmed, startRefund } from "./payments/index";
import { validatePromotionInput, type PromotionInput } from "./promo";
import { countOpenReports } from "./reports";
import { addDays, doualaDateTime, doualaDay, formatDoualaSlot } from "./time";

/**
 * Back-office V1. Chaque action qui modifie une donnée écrit, dans la même transaction,
 * une ligne de journal d’audit (qui, quoi, sur quoi, quand) : si l’une échoue, rien n’est enregistré.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function audit(tx: Tx, actorUserId: number, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ actorUserId, action, entityType, entityId, metadata: metadata ? JSON.stringify(metadata) : null });
}

const likeTerm = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

// ---------------------------------------------------------------------------
// Vue d’ensemble
// ---------------------------------------------------------------------------

export async function getOverview(db: Database, now = new Date()) {
  const today = doualaDay(now);
  const todayStart = doualaDateTime(today, "00:00");
  const tomorrowStart = doualaDateTime(addDays(today, 1), "00:00");
  const firstDay = addDays(today, -6);
  const weekStart = doualaDateTime(firstDay, "00:00");

  // Rendez-vous des 7 derniers jours (aujourd’hui compris), datés à leur jour de rendez-vous à Douala.
  const week = await db.select({ status: bookings.status, totalXaf: bookings.totalXaf, startsAt: bookings.startsAt, professionalId: bookings.professionalId })
    .from(bookings).where(and(gte(bookings.startsAt, weekStart), lt(bookings.startsAt, tomorrowStart)));
  const todayRows = week.filter((row) => row.startsAt >= todayStart);
  const decided = week.filter((row) => row.status !== "pending");
  const kept = decided.filter((row) => row.status === "confirmed" || row.status === "completed");

  const days = Array.from({ length: 7 }, (_, index) => addDays(firstDay, index));
  const perDay = days.map((day) => ({ day, count: week.filter((row) => doualaDay(row.startsAt) === day).length }));

  const proStats = new Map<number, { count: number; volume: number }>();
  for (const row of week) {
    if (row.status === "cancelled" || row.status === "refused") continue;
    const stat = proStats.get(row.professionalId) ?? { count: 0, volume: 0 };
    stat.count += 1;
    stat.volume += row.totalXaf;
    proStats.set(row.professionalId, stat);
  }
  const topIds = [...proStats.entries()].sort((a, b) => b[1].count - a[1].count || b[1].volume - a[1].volume).slice(0, 3);
  const topProfiles = topIds.length ? await db.select().from(professionalProfiles).where(inArray(professionalProfiles.id, topIds.map(([id]) => id))) : [];
  const topProfessionals = topIds.map(([id, stat]) => {
    const profile = topProfiles.find((item) => item.id === id);
    return { slug: profile?.slug ?? "", name: profile?.displayName ?? "—", city: profile?.city ?? "", count: stat.count, volumeXaf: stat.volume };
  });

  const [[pendingPros], [pendingBookings], userCounts, [newClients], reportsOpen] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(professionalProfiles).where(eq(professionalProfiles.verificationStatus, "pending")),
    db.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.status, "pending"), gte(bookings.startsAt, now))),
    db.select({ status: users.status, count: sql<number>`count(*)` }).from(users).groupBy(users.status),
    db.select({ count: sql<number>`count(*)` }).from(users).where(gte(users.createdAt, weekStart)),
    countOpenReports(db),
  ]);

  return {
    today,
    week: { from: firstDay, to: today },
    bookingsToday: todayRows.length,
    bookingsTodayPending: todayRows.filter((row) => row.status === "pending").length,
    confirmationRate: decided.length ? Math.round((kept.length / decided.length) * 100) : null,
    decidedCount: decided.length,
    keptCount: kept.length,
    bookedVolumeXaf: kept.reduce((sum, row) => sum + row.totalXaf, 0),
    cancellations: week.filter((row) => row.status === "cancelled").length,
    noShows: week.filter((row) => row.status === "no_show").length,
    perDay,
    topProfessionals,
    professionalsPending: Number(pendingPros.count),
    bookingsPendingUpcoming: Number(pendingBookings.count),
    usersActive: Number(userCounts.find((row) => row.status === "active")?.count ?? 0),
    usersSuspended: Number(userCounts.find((row) => row.status === "suspended")?.count ?? 0),
    newUsersWeek: Number(newClients.count),
    reportsOpen,
  };
}

// ---------------------------------------------------------------------------
// Professionnels
// ---------------------------------------------------------------------------

export type ProfessionalStatus = "pending" | "verified" | "suspended" | "refused";
export type ProfessionalAction = "validate" | "refuse" | "suspend" | "reactivate";

const PRO_TRANSITIONS: Record<ProfessionalAction, { from: ProfessionalStatus[]; to: ProfessionalStatus; label: string; needsReason: boolean }> = {
  validate: { from: ["pending", "refused"], to: "verified", label: "Professionnel validé", needsReason: false },
  refuse: { from: ["pending"], to: "refused", label: "Inscription refusée", needsReason: true },
  suspend: { from: ["pending", "verified"], to: "suspended", label: "Professionnel suspendu", needsReason: true },
  reactivate: { from: ["suspended"], to: "verified", label: "Professionnel réactivé", needsReason: false },
};

export async function listProfessionals(db: Database, input: { status?: ProfessionalStatus; query?: string } = {}) {
  const filters = [];
  if (input.status) filters.push(eq(professionalProfiles.verificationStatus, input.status));
  if (input.query?.trim()) {
    const term = likeTerm(input.query.trim());
    filters.push(or(like(professionalProfiles.displayName, term), like(professionalProfiles.salonName, term), like(professionalProfiles.city, term), like(professionalProfiles.neighborhood, term)));
  }
  const profiles = await db.select().from(professionalProfiles).where(filters.length ? and(...filters) : undefined).orderBy(desc(professionalProfiles.createdAt)).limit(200);
  const ids = profiles.map((profile) => profile.id);
  const [serviceCounts, bookingCounts, statusCounts] = await Promise.all([
    ids.length ? db.select({ id: serviceCatalog.professionalId, count: sql<number>`count(*)` }).from(serviceCatalog).where(and(inArray(serviceCatalog.professionalId, ids), eq(serviceCatalog.isActive, 1))).groupBy(serviceCatalog.professionalId) : [],
    ids.length ? db.select({ id: bookings.professionalId, count: sql<number>`count(*)` }).from(bookings).where(inArray(bookings.professionalId, ids)).groupBy(bookings.professionalId) : [],
    db.select({ status: professionalProfiles.verificationStatus, count: sql<number>`count(*)` }).from(professionalProfiles).groupBy(professionalProfiles.verificationStatus),
  ]);
  const counts = { pending: 0, verified: 0, suspended: 0, refused: 0 } as Record<ProfessionalStatus, number>;
  for (const row of statusCounts) counts[row.status] = Number(row.count);
  return {
    counts,
    items: profiles.map((profile) => ({
      slug: profile.slug, name: profile.displayName, salon: profile.salonName ?? "", city: profile.city, neighborhood: profile.neighborhood ?? "",
      mode: profile.mode, status: profile.verificationStatus, note: profile.verificationNote, createdAt: profile.createdAt.toISOString(),
      servicesCount: Number(serviceCounts.find((row) => row.id === profile.id)?.count ?? 0),
      bookingsCount: Number(bookingCounts.find((row) => row.id === profile.id)?.count ?? 0),
    })),
  };
}

export async function setProfessionalStatus(db: Database, actorUserId: number, input: { slug: string; action: ProfessionalAction; reason?: string }) {
  const rule = PRO_TRANSITIONS[input.action];
  const reason = input.reason?.trim() || null;
  if (rule.needsReason && (!reason || reason.length < 3)) throw new BusinessError("REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(professionalProfiles).where(eq(professionalProfiles.slug, input.slug)).limit(1).for("update");
    if (!profile) throw new BusinessError("PROFESSIONAL_NOT_FOUND");
    if (!rule.from.includes(profile.verificationStatus)) throw new BusinessError("INVALID_TRANSITION");
    await tx.update(professionalProfiles).set({ verificationStatus: rule.to, verificationNote: reason }).where(eq(professionalProfiles.id, profile.id));
    await audit(tx, actorUserId, rule.label, "professional", profile.slug, { name: profile.displayName, from: profile.verificationStatus, to: rule.to, reason });
    const message = { validate: "Votre profil est vérifié : le badge « Vérifié » est visible.", refuse: "Votre inscription a été refusée.", suspend: "Votre profil est suspendu.", reactivate: "Votre profil est réactivé." }[input.action];
    await notify(tx, { userId: profile.ownerUserId, type: `professional.${input.action}`, title: message, body: reason, link: "/professionnel" });
    return { slug: profile.slug, status: rule.to };
  });
}

// ---------------------------------------------------------------------------
// Réservations
// ---------------------------------------------------------------------------

/** Transitions autorisées depuis l’administration (support, litiges). */
export const ADMIN_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "refused", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  refused: [],
  cancelled: [],
  completed: [],
  no_show: [],
};
const TRANSITION_LABELS: Record<BookingStatus, string> = {
  pending: "Remise en attente", confirmed: "Réservation confirmée", refused: "Réservation refusée",
  cancelled: "Réservation annulée (litige)", completed: "Réservation terminée", no_show: "Absence client enregistrée",
};

export type AdminBookingView = BookingView & { customerUserId: number | null; allowedTransitions: BookingStatus[] };

async function toAdminViews(db: Database, rows: (typeof bookings.$inferSelect)[]): Promise<AdminBookingView[]> {
  const views = await buildViews(db, rows);
  return views.map((view, index) => ({ ...view, customerUserId: rows[index].customerUserId, allowedTransitions: ADMIN_BOOKING_TRANSITIONS[view.status] }));
}

export async function listBookings(db: Database, input: { status?: BookingStatus; query?: string; limit?: number } = {}) {
  const filters = [];
  if (input.status) filters.push(eq(bookings.status, input.status));
  if (input.query?.trim()) {
    const term = likeTerm(input.query.trim());
    const pros = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(like(professionalProfiles.displayName, term));
    const digits = input.query.replace(/\D/g, "");
    filters.push(or(
      like(bookings.reference, term), like(bookings.customerName, term),
      ...(digits.length >= 4 ? [like(bookings.customerPhone, `%${digits}%`)] : []),
      ...(pros.length ? [inArray(bookings.professionalId, pros.map((pro) => pro.id))] : []),
    ));
  }
  const rows = await db.select().from(bookings).where(filters.length ? and(...filters) : undefined).orderBy(desc(bookings.startsAt)).limit(Math.min(input.limit ?? 100, 200));
  const statusCounts = await db.select({ status: bookings.status, count: sql<number>`count(*)` }).from(bookings).groupBy(bookings.status);
  const counts = { pending: 0, confirmed: 0, refused: 0, cancelled: 0, completed: 0, no_show: 0 } as Record<BookingStatus, number>;
  for (const row of statusCounts) counts[row.status] = Number(row.count);
  return { counts, items: await toAdminViews(db, rows) };
}

export async function transitionBooking(db: Database, actorUserId: number, input: { reference: string; to: BookingStatus; note?: string }) {
  const note = input.note?.trim() || null;
  if ((input.to === "cancelled" || input.to === "refused") && (!note || note.length < 3)) throw new BusinessError("REASON_REQUIRED");
  const refundId = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1).for("update");
    if (!booking) throw new BusinessError("BOOKING_NOT_FOUND");
    if (!ADMIN_BOOKING_TRANSITIONS[booking.status].includes(input.to)) throw new BusinessError("INVALID_TRANSITION");
    await tx.update(bookings).set({ status: input.to }).where(eq(bookings.id, booking.id));
    await tx.insert(bookingEvents).values({ bookingId: booking.id, actorUserId, fromStatus: booking.status, toStatus: input.to, note: note ? `Administration : ${note}` : "Action de l’administration" });
    await audit(tx, actorUserId, TRANSITION_LABELS[input.to], "booking", booking.reference, { from: booking.status, to: input.to, note });
    const [pro] = await tx.select({ name: professionalProfiles.displayName }).from(professionalProfiles).where(eq(professionalProfiles.id, booking.professionalId)).limit(1);
    await notifyCustomerOfStatus(tx, booking, input.to, pro?.name ?? "Le professionnel", note);
    if (input.to === "cancelled" || input.to === "confirmed") await notifyProfessional(tx, booking.professionalId, { type: `booking.admin_${input.to}`, title: input.to === "cancelled" ? "Rendez-vous annulé par KOFI" : "Rendez-vous confirmé par KOFI", body: `${booking.customerName} · ${formatDoualaSlot(booking.startsAt)}${note ? ` · ${note}` : ""}`, link: "/professionnel" });
    if (input.to === "confirmed") await onBookingConfirmed(tx, booking);
    if (input.to === "completed") await onBookingCompleted(tx, booking);
    if ((input.to === "refused" || input.to === "cancelled") && (await onBookingClosed(tx, booking))) return booking.id;
    return null;
  });
  if (refundId) await startRefund(db, refundId);
  const rows = await db.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1);
  return (await toAdminViews(db, rows))[0];
}

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

export async function listUsers(db: Database, input: { query?: string; role?: Role | "staff"; status?: "active" | "suspended" } = {}) {
  const filters = [];
  if (input.role === "staff") filters.push(inArray(users.role, ["support", "moderator", "admin", "superadmin"]));
  else if (input.role) filters.push(eq(users.role, input.role));
  if (input.status) filters.push(eq(users.status, input.status));
  if (input.query?.trim()) {
    const term = likeTerm(input.query.trim());
    // Le téléphone n’est pas dans le compte : on retrouve aussi les clients via le numéro saisi sur leurs réservations.
    const digits = input.query.replace(/\D/g, "");
    const byPhone = digits.length >= 4 ? await db.selectDistinct({ id: bookings.customerUserId }).from(bookings).where(like(bookings.customerPhone, `%${digits}%`)) : [];
    const ids = byPhone.map((row) => row.id).filter((id): id is number => id !== null);
    filters.push(or(like(users.name, term), like(users.email, term), ...(ids.length ? [inArray(users.id, ids)] : [])));
  }
  const rows = await db.select().from(users).where(filters.length ? and(...filters) : undefined).orderBy(desc(users.createdAt)).limit(200);
  const ids = rows.map((row) => row.id);
  const [bookingCounts, phones] = await Promise.all([
    ids.length ? db.select({ id: bookings.customerUserId, count: sql<number>`count(*)` }).from(bookings).where(inArray(bookings.customerUserId, ids)).groupBy(bookings.customerUserId) : [],
    ids.length ? db.select({ id: bookings.customerUserId, phone: bookings.customerPhone }).from(bookings).where(inArray(bookings.customerUserId, ids)).orderBy(desc(bookings.createdAt)) : [],
  ]);
  return rows.map((row) => ({
    id: row.id, name: row.name ?? "Sans nom", email: row.email, role: row.role, status: row.status,
    createdAt: row.createdAt.toISOString(), lastSignedIn: row.lastSignedIn.toISOString(),
    bookingsCount: Number(bookingCounts.find((item) => item.id === row.id)?.count ?? 0),
    lastPhone: phones.find((item) => item.id === row.id)?.phone ?? null,
  }));
}

export async function setUserStatus(db: Database, actorUserId: number, input: { userId: number; status: "active" | "suspended"; reason?: string }, actorRole: string = "admin") {
  if (input.userId === actorUserId) throw new BusinessError("CANNOT_SUSPEND_SELF");
  const reason = input.reason?.trim() || null;
  if (input.status === "suspended" && (!reason || reason.length < 3)) throw new BusinessError("REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1).for("update");
    if (!user) throw new BusinessError("USER_NOT_FOUND");
    if (!canManageAccount(actorRole, user.role)) throw new BusinessError("ACCOUNT_PROTECTED");
    if (user.status === input.status) return { id: user.id, status: user.status };
    await tx.update(users).set({ status: input.status }).where(eq(users.id, user.id));
    await audit(tx, actorUserId, input.status === "suspended" ? "Compte suspendu" : "Compte réactivé", "user", String(user.id), { name: user.name, reason });
    return { id: user.id, status: input.status };
  });
}

// ---------------------------------------------------------------------------
// Journal d’audit (lecture seule : aucune procédure ne modifie ni ne supprime une ligne)
// ---------------------------------------------------------------------------

export async function listAudit(db: Database, input: { limit?: number } = {}) {
  const rows = await db.select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actorName: users.name, actorId: auditLogs.actorUserId })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).orderBy(desc(auditLogs.id)).limit(Math.min(input.limit ?? 100, 500));
  return rows.map((row) => {
    let meta: Record<string, unknown> = {};
    try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { /* métadonnées illisibles : ignorées */ }
    const target = typeof meta.name === "string" && meta.name ? meta.name : row.entityId;
    const detail = [meta.reason, meta.note].find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
    return { id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId, target, detail, actor: row.actorName ?? `Utilisateur #${row.actorId}`, createdAt: row.createdAt.toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Rôles de l’équipe (super-administrateur uniquement)
// ---------------------------------------------------------------------------

export async function setUserRole(db: Database, actorUserId: number, input: { userId: number; role: Role }, actorRole: string = "admin") {
  if (input.userId === actorUserId) throw new BusinessError("CANNOT_CHANGE_OWN_ROLE");
  if (!assignableRoles(actorRole).includes(input.role)) throw new BusinessError("ROLE_NOT_ALLOWED");
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1).for("update");
    if (!user) throw new BusinessError("USER_NOT_FOUND");
    if (!canManageAccount(actorRole, user.role)) throw new BusinessError("ACCOUNT_PROTECTED");
    if (user.role === input.role) return { id: user.id, role: user.role };
    await tx.update(users).set({ role: input.role }).where(eq(users.id, user.id));
    await audit(tx, actorUserId, "Rôle modifié", "user", String(user.id), { name: user.name, from: ROLE_LABELS[user.role], to: ROLE_LABELS[input.role], note: `${ROLE_LABELS[user.role]} → ${ROLE_LABELS[input.role]}` });
    return { id: user.id, role: input.role };
  });
}

// ---------------------------------------------------------------------------
// Codes promo
// ---------------------------------------------------------------------------

export async function createPromotion(db: Database, actorUserId: number, input: PromotionInput) {
  const values = validatePromotionInput(input);
  return db.transaction(async (tx) => {
    const taken = await tx.select({ id: promotions.id }).from(promotions).where(eq(promotions.code, values.code)).limit(1);
    if (taken.length) throw new BusinessError("PROMO_CODE_TAKEN");
    const [inserted] = await tx.insert(promotions).values({ ...values, isEnabled: 1 }).$returningId();
    const detail = values.discountType === "percentage" ? `-${values.discountValue} %` : `-${values.discountValue} FCFA`;
    await audit(tx, actorUserId, "Code promo créé", "promotion", values.code, { name: values.code, note: `${values.label} (${detail})` });
    return { id: inserted.id, code: values.code };
  });
}

export async function setPromotionEnabled(db: Database, actorUserId: number, input: { id: number; enabled: boolean }) {
  return db.transaction(async (tx) => {
    const [promotion] = await tx.select().from(promotions).where(eq(promotions.id, input.id)).limit(1).for("update");
    if (!promotion) throw new BusinessError("PROMO_INVALID");
    await tx.update(promotions).set({ isEnabled: input.enabled ? 1 : 0 }).where(eq(promotions.id, promotion.id));
    await audit(tx, actorUserId, input.enabled ? "Code promo activé" : "Code promo désactivé", "promotion", promotion.code, { name: promotion.code });
    return { id: promotion.id, enabled: input.enabled };
  });
}
