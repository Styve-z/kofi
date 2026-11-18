import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { availabilitySlots, bookingEvents, bookings, professionalProfiles, serviceCatalog } from "../../drizzle/schema";
import type { Database } from "../db";
import { buildViews, type BookingStatus, type BookingView } from "./booking";
import { BusinessError } from "./errors";
import { notifyCustomerOfStatus } from "./notifications";
import { onBookingClosed, onBookingCompleted, onBookingConfirmed, startRefund } from "./payments/index";
import { DEFAULT_WEEKLY_HOURS, isValidWeeklyHours, parseWeeklyHours, regenerateOpenSlots, type WeeklyHours } from "./schedule";
import { addDays, doualaDateTime, doualaDay } from "./time";

/**
 * Espace professionnel. Un compte KOFI possède au plus un profil professionnel
 * (`professional_profiles.ownerUserId`). Toutes les fonctions partent du compte connecté :
 * un professionnel ne peut ni lire ni modifier les données d’un autre.
 */

type Profile = typeof professionalProfiles.$inferSelect;

export type ProfileInput = {
  displayName: string; salonName?: string; city: string; neighborhood?: string;
  mode: "salon" | "domicile" | "les deux"; bio?: string; specialties?: string[];
};

const ACTIVE: BookingStatus[] = ["pending", "confirmed"];

async function ownedProfile(db: Pick<Database, "select">, userId: number, lock = false): Promise<Profile> {
  const query = db.select().from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  const [profile] = lock ? await query.for("update") : await query;
  if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
  return profile;
}

function assertNotSuspended(profile: Profile) {
  if (profile.verificationStatus === "suspended") throw new BusinessError("PROFESSIONAL_SUSPENDED");
}

export function slugify(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "pro";
}

function cleanProfile(input: ProfileInput) {
  const displayName = input.displayName.trim();
  const city = input.city.trim();
  if (displayName.length < 2 || city.length < 2) throw new BusinessError("PROFILE_INVALID");
  const specialties = [...new Set((input.specialties ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  return {
    displayName, city, mode: input.mode,
    salonName: input.salonName?.trim() || null, neighborhood: input.neighborhood?.trim() || null,
    bio: input.bio?.trim() || null, specialties: JSON.stringify(specialties),
  };
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

export async function getMyProfessional(db: Database, userId: number) {
  const [profile] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  if (!profile) return null;
  const services = await db.select().from(serviceCatalog).where(eq(serviceCatalog.professionalId, profile.id)).orderBy(desc(serviceCatalog.isActive), asc(serviceCatalog.name));
  let specialties: string[] = [];
  try { specialties = JSON.parse(profile.specialties ?? "[]"); } catch { /* ignoré */ }
  return {
    slug: profile.slug, displayName: profile.displayName, salonName: profile.salonName ?? "", city: profile.city, neighborhood: profile.neighborhood ?? "",
    mode: profile.mode, bio: profile.bio ?? "", specialties, status: profile.verificationStatus, statusNote: profile.verificationNote,
    rating: Number(profile.rating), reviewCount: profile.reviewCount,
    weeklyHours: parseWeeklyHours(profile.weeklyHours) ?? {},
    services: services.map((service) => ({ id: service.code, name: service.name, category: service.category ?? "", durationMinutes: service.durationMinutes, preparationMinutes: service.preparationMinutes, priceXaf: service.priceXaf, active: service.isActive === 1 })),
  };
}

/** Demande d’inscription : le profil est créé « en attente » et reste invisible tant que l’administration ne l’a pas validé… */
export async function applyAsProfessional(db: Database, userId: number, input: ProfileInput, now = new Date()) {
  const values = cleanProfile(input);
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1).for("update");
    if (existing.length) throw new BusinessError("ALREADY_PROFESSIONAL");
    let slug = slugify(values.displayName);
    const taken = await tx.select({ slug: professionalProfiles.slug }).from(professionalProfiles).where(eq(professionalProfiles.slug, slug)).limit(1);
    if (taken.length) slug = `${slug}-${nanoid(5).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    const [inserted] = await tx.insert(professionalProfiles).values({ ...values, slug, ownerUserId: userId, verificationStatus: "pending", weeklyHours: JSON.stringify(DEFAULT_WEEKLY_HOURS) }).$returningId();
    await regenerateOpenSlots(tx, inserted.id, DEFAULT_WEEKLY_HOURS, now);
    return { slug };
  });
}

/** Mise à jour du profil. Un profil refusé repasse « en attente » : c’est une nouvelle demande de validation. */
export async function updateMyProfile(db: Database, userId: number, input: ProfileInput) {
  const values = cleanProfile(input);
  return db.transaction(async (tx) => {
    const profile = await ownedProfile(tx, userId, true);
    const resubmit = profile.verificationStatus === "refused";
    await tx.update(professionalProfiles).set({ ...values, ...(resubmit ? { verificationStatus: "pending" as const, verificationNote: null } : {}) }).where(eq(professionalProfiles.id, profile.id));
    return { slug: profile.slug, status: resubmit ? "pending" : profile.verificationStatus };
  });
}

// ---------------------------------------------------------------------------
// Prestations
// ---------------------------------------------------------------------------

export type ServiceInput = { id?: string; name: string; category?: string; durationMinutes: number; preparationMinutes?: number; priceXaf: number };

export async function saveService(db: Database, userId: number, input: ServiceInput) {
  const name = input.name.trim();
  if (name.length < 2 || input.durationMinutes < 10 || input.durationMinutes > 600 || input.priceXaf < 500 || input.priceXaf > 1_000_000 || (input.preparationMinutes ?? 0) < 0 || (input.preparationMinutes ?? 0) > 120) throw new BusinessError("SERVICE_INVALID");
  const profile = await ownedProfile(db, userId);
  const values = { name, category: input.category?.trim() || null, durationMinutes: input.durationMinutes, preparationMinutes: input.preparationMinutes ?? 0, priceXaf: input.priceXaf };
  if (input.id) {
    const result = await db.update(serviceCatalog).set(values).where(and(eq(serviceCatalog.professionalId, profile.id), eq(serviceCatalog.code, input.id)));
    if (!result[0].affectedRows) throw new BusinessError("SERVICE_NOT_FOUND");
    return { id: input.id };
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(serviceCatalog).where(eq(serviceCatalog.professionalId, profile.id));
  if (Number(count) >= 40) throw new BusinessError("SERVICE_LIMIT");
  const code = `${slugify(profile.slug).slice(0, 30)}-${slugify(name).slice(0, 30)}-${nanoid(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await db.insert(serviceCatalog).values({ ...values, professionalId: profile.id, code, isActive: 1 });
  return { id: code };
}

/** Désactiver plutôt que supprimer : les réservations passées gardent leur prestation. */
export async function setServiceActive(db: Database, userId: number, input: { id: string; active: boolean }) {
  const profile = await ownedProfile(db, userId);
  const result = await db.update(serviceCatalog).set({ isActive: input.active ? 1 : 0 }).where(and(eq(serviceCatalog.professionalId, profile.id), eq(serviceCatalog.code, input.id)));
  if (!result[0].affectedRows) throw new BusinessError("SERVICE_NOT_FOUND");
  return { id: input.id, active: input.active };
}

// ---------------------------------------------------------------------------
// Horaires et indisponibilités
// ---------------------------------------------------------------------------

export async function setWeeklyHours(db: Database, userId: number, hours: WeeklyHours, now = new Date()) {
  if (!isValidWeeklyHours(hours)) throw new BusinessError("HOURS_INVALID");
  return db.transaction(async (tx) => {
    const profile = await ownedProfile(tx, userId, true);
    await tx.update(professionalProfiles).set({ weeklyHours: JSON.stringify(hours) }).where(eq(professionalProfiles.id, profile.id));
    const days = await regenerateOpenSlots(tx, profile.id, hours, now);
    // Les réservations déjà prises restent valables même hors des nouveaux horaires : on les signale.
    const outside = await tx.select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt }).from(bookings).where(and(eq(bookings.professionalId, profile.id), inArray(bookings.status, ACTIVE), gte(bookings.startsAt, now)));
    const windows = outside.length ? await tx.select().from(availabilitySlots).where(and(eq(availabilitySlots.professionalId, profile.id), eq(availabilitySlots.status, "open"), gte(availabilitySlots.endsAt, now))) : [];
    const conflicts = outside.filter((booking) => !windows.some((window) => window.startsAt <= booking.startsAt && window.endsAt >= booking.endsAt)).length;
    return { openingDays: days, bookingsOutsideHours: conflicts };
  });
}

export async function listClosures(db: Database, userId: number, now = new Date()) {
  const profile = await ownedProfile(db, userId);
  const rows = await db.select().from(availabilitySlots).where(and(eq(availabilitySlots.professionalId, profile.id), inArray(availabilitySlots.status, ["blocked", "leave", "holiday"]), gt(availabilitySlots.endsAt, now))).orderBy(asc(availabilitySlots.startsAt));
  return rows.map((row) => ({ id: row.id, status: row.status, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), note: row.note }));
}

/** Congé, jour férié ou blocage ponctuel. Les réservations déjà prises sur la période sont comptées pour que le pro les traite. */
export async function addClosure(db: Database, userId: number, input: { startsAt: string; endsAt: string; status: "blocked" | "leave" | "holiday"; note?: string }, now = new Date()) {
  const starts = new Date(input.startsAt);
  const ends = new Date(input.endsAt);
  if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts || ends <= now || ends.getTime() - starts.getTime() > 92 * 86_400_000) throw new BusinessError("INVALID_TIME_RANGE");
  const profile = await ownedProfile(db, userId);
  await db.insert(availabilitySlots).values({ professionalId: profile.id, startsAt: starts, endsAt: ends, status: input.status, note: input.note?.trim().slice(0, 255) || null });
  const affected = await db.select({ reference: bookings.reference }).from(bookings).where(and(eq(bookings.professionalId, profile.id), inArray(bookings.status, ACTIVE), lt(bookings.startsAt, ends), gt(bookings.endsAt, starts)));
  return { affectedBookings: affected.map((row) => row.reference) };
}

export async function removeClosure(db: Database, userId: number, id: number) {
  const profile = await ownedProfile(db, userId);
  const result = await db.delete(availabilitySlots).where(and(eq(availabilitySlots.id, id), eq(availabilitySlots.professionalId, profile.id), inArray(availabilitySlots.status, ["blocked", "leave", "holiday"])));
  if (!result[0].affectedRows) throw new BusinessError("CLOSURE_NOT_FOUND");
  return { id };
}

// ---------------------------------------------------------------------------
// Demandes et rendez-vous
// ---------------------------------------------------------------------------

/** Ce que le professionnel peut faire sur une réservation. Terminer ou signaler une absence n’est possible qu’une fois l’heure passée. */
export function proTransitions(status: BookingStatus, startsAt: Date, now = new Date()): BookingStatus[] {
  if (status === "pending") return ["confirmed", "refused"];
  if (status === "confirmed") return startsAt <= now ? ["completed", "no_show", "cancelled"] : ["cancelled"];
  return [];
}

export type ProBookingView = BookingView & { allowedTransitions: BookingStatus[] };

export async function listMyBookings(db: Database, userId: number, input: { scope: "pending" | "upcoming" | "past" }, now = new Date()): Promise<ProBookingView[]> {
  const profile = await ownedProfile(db, userId);
  const base = eq(bookings.professionalId, profile.id);
  const where = input.scope === "pending" ? and(base, eq(bookings.status, "pending"), gte(bookings.endsAt, now))
    : input.scope === "upcoming" ? and(base, eq(bookings.status, "confirmed"), gte(bookings.endsAt, doualaDateTime(doualaDay(now), "00:00")))
      : and(base, lt(bookings.startsAt, now));
  const rows = await db.select().from(bookings).where(where).orderBy(input.scope === "past" ? desc(bookings.startsAt) : asc(bookings.startsAt)).limit(100);
  const views = await buildViews(db, rows);
  return views.map((view, index) => ({ ...view, allowedTransitions: proTransitions(view.status, rows[index].startsAt, now) }));
}

export async function transitionMyBooking(db: Database, userId: number, input: { reference: string; to: BookingStatus; note?: string }, now = new Date()) {
  const note = input.note?.trim() || null;
  if ((input.to === "refused" || input.to === "cancelled") && (!note || note.length < 3)) throw new BusinessError("REASON_REQUIRED");
  const refundId = await db.transaction(async (tx) => {
    const profile = await ownedProfile(tx, userId);
    assertNotSuspended(profile);
    const [booking] = await tx.select().from(bookings).where(and(eq(bookings.reference, input.reference), eq(bookings.professionalId, profile.id))).limit(1).for("update");
    if (!booking) throw new BusinessError("BOOKING_NOT_FOUND");
    if (!proTransitions(booking.status, booking.startsAt, now).includes(input.to)) throw new BusinessError("INVALID_TRANSITION");
    await tx.update(bookings).set({ status: input.to }).where(eq(bookings.id, booking.id));
    await tx.insert(bookingEvents).values({ bookingId: booking.id, actorUserId: userId, fromStatus: booking.status, toStatus: input.to, note: note ? `Professionnel : ${note}` : "Action du professionnel" });
    await notifyCustomerOfStatus(tx, booking, input.to, profile.displayName, note);
    if (input.to === "confirmed") await onBookingConfirmed(tx, booking);
    if (input.to === "completed") await onBookingCompleted(tx, booking);
    if ((input.to === "refused" || input.to === "cancelled") && (await onBookingClosed(tx, booking))) return booking.id;
    return null;
  });
  if (refundId) await startRefund(db, refundId);
  const rows = await db.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1);
  const [view] = await buildViews(db, rows);
  return { ...view, allowedTransitions: proTransitions(view.status, rows[0].startsAt, now) };
}

export async function getMyOverview(db: Database, userId: number, now = new Date()) {
  const profile = await ownedProfile(db, userId);
  const today = doualaDay(now);
  const weekEnd = doualaDateTime(addDays(today, 7), "00:00");
  const monthStart = doualaDateTime(`${today.slice(0, 7)}-01`, "00:00");
  const [[pending], [upcoming], [todayCount], [month], [services]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.professionalId, profile.id), eq(bookings.status, "pending"), gte(bookings.endsAt, now))),
    db.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.professionalId, profile.id), eq(bookings.status, "confirmed"), gte(bookings.startsAt, now), lt(bookings.startsAt, weekEnd))),
    db.select({ count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.professionalId, profile.id), inArray(bookings.status, ["confirmed", "completed"]), gte(bookings.startsAt, doualaDateTime(today, "00:00")), lt(bookings.startsAt, doualaDateTime(addDays(today, 1), "00:00")))),
    db.select({ total: sql<number>`coalesce(sum(${bookings.totalXaf}), 0)`, count: sql<number>`count(*)` }).from(bookings).where(and(eq(bookings.professionalId, profile.id), eq(bookings.status, "completed"), gte(bookings.startsAt, monthStart))),
    db.select({ count: sql<number>`count(*)` }).from(serviceCatalog).where(and(eq(serviceCatalog.professionalId, profile.id), eq(serviceCatalog.isActive, 1))),
  ]);
  return {
    pendingRequests: Number(pending.count), confirmedNext7Days: Number(upcoming.count), appointmentsToday: Number(todayCount.count),
    completedThisMonth: Number(month.count), revenueThisMonthXaf: Number(month.total), activeServices: Number(services.count),
    hasHours: Object.keys(parseWeeklyHours(profile.weeklyHours) ?? {}).length > 0,
    rating: Number(profile.rating), reviewCount: profile.reviewCount, status: profile.verificationStatus,
  };
}
