import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, bookings, professionalProfiles, reviews, users } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { notifyProfessional } from "./notifications";

/**
 * Avis vérifiés : seul le client d’une réservation terminée peut noter, une seule fois,
 * dans les 30 jours suivant le rendez-vous. La note publique est la moyenne des avis visibles.
 */

export const REVIEW_WINDOW_DAYS = 30;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** « Amina N. » : prénom et initiale seulement, pour la vie privée des clients. */
export function displayName(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Client KOFI";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function isReviewable(booking: { status: string; startsAt: Date }, now = new Date()) {
  return booking.status === "completed" && now.getTime() - booking.startsAt.getTime() <= REVIEW_WINDOW_DAYS * 86_400_000;
}

async function recompute(tx: Tx, professionalId: number) {
  const [stats] = await tx.select({ average: sql<string | null>`avg(${reviews.rating})`, count: sql<number>`count(*)` }).from(reviews).where(and(eq(reviews.professionalId, professionalId), eq(reviews.status, "visible")));
  const count = Number(stats.count);
  await tx.update(professionalProfiles).set({ rating: count ? Number(stats.average).toFixed(2) : "0.00", reviewCount: count }).where(eq(professionalProfiles.id, professionalId));
}

export async function createReview(db: Database, userId: number, input: { reference: string; rating: number; comment?: string }, now = new Date()) {
  const comment = input.comment?.trim() || null;
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5 || (comment && comment.length > 1000)) throw new BusinessError("REVIEW_INVALID");
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1).for("update");
    if (!booking || booking.customerUserId !== userId) throw new BusinessError("BOOKING_NOT_FOUND");
    if (!isReviewable(booking, now)) throw new BusinessError("REVIEW_NOT_ALLOWED");
    const existing = await tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.bookingId, booking.id)).limit(1);
    if (existing.length) throw new BusinessError("REVIEW_EXISTS");
    const [inserted] = await tx.insert(reviews).values({ bookingId: booking.id, professionalId: booking.professionalId, customerUserId: userId, rating: input.rating, comment, status: "visible" }).$returningId();
    await recompute(tx, booking.professionalId);
    await notifyProfessional(tx, booking.professionalId, { type: "review.created", title: `Nouvel avis : ${input.rating}/5`, body: comment ? `« ${comment.slice(0, 140)} »` : null, link: "/professionnel" });
    return { id: inserted.id };
  });
}

async function describe(db: Database, rows: (typeof reviews.$inferSelect)[]) {
  const userIds = [...new Set(rows.map((row) => row.customerUserId))];
  const proIds = [...new Set(rows.map((row) => row.professionalId))];
  const bookingIds = rows.map((row) => row.bookingId);
  const [authors, pros, bookingRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
    proIds.length ? db.select({ id: professionalProfiles.id, name: professionalProfiles.displayName, slug: professionalProfiles.slug }).from(professionalProfiles).where(inArray(professionalProfiles.id, proIds)) : [],
    bookingIds.length ? db.select({ id: bookings.id, reference: bookings.reference }).from(bookings).where(inArray(bookings.id, bookingIds)) : [],
  ]);
  return rows.map((row) => ({
    id: row.id, rating: row.rating, comment: row.comment, status: row.status, moderationNote: row.moderationNote,
    proReply: row.proReply, createdAt: row.createdAt.toISOString(),
    author: displayName(authors.find((author) => author.id === row.customerUserId)?.name ?? null),
    professional: pros.find((pro) => pro.id === row.professionalId) ?? null,
    bookingReference: bookingRows.find((booking) => booking.id === row.bookingId)?.reference ?? null,
  }));
}

/** Avis publics d’un professionnel (visibles seulement, sans données personnelles). */
export async function listPublicReviews(db: Database, slug: string, limit = 20) {
  const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.slug, slug)).limit(1);
  if (!profile) return [];
  const rows = await db.select().from(reviews).where(and(eq(reviews.professionalId, profile.id), eq(reviews.status, "visible"))).orderBy(desc(reviews.id)).limit(Math.min(limit, 50));
  return (await describe(db, rows)).map(({ id, rating, comment, proReply, createdAt, author }) => ({ id, rating, comment, proReply, createdAt, author }));
}

export async function listMyProfessionalReviews(db: Database, userId: number) {
  const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
  const rows = await db.select().from(reviews).where(eq(reviews.professionalId, profile.id)).orderBy(desc(reviews.id)).limit(100);
  return describe(db, rows);
}

/** Le professionnel répond une fois, publiquement, à un avis le concernant. */
export async function replyToReview(db: Database, userId: number, input: { id: number; reply: string }) {
  const reply = input.reply.trim();
  if (reply.length < 2 || reply.length > 1000) throw new BusinessError("REVIEW_INVALID");
  return db.transaction(async (tx) => {
    const [profile] = await tx.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
    if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
    const [review] = await tx.select().from(reviews).where(and(eq(reviews.id, input.id), eq(reviews.professionalId, profile.id))).limit(1).for("update");
    if (!review) throw new BusinessError("REVIEW_NOT_FOUND");
    if (review.proReply) throw new BusinessError("REVIEW_ALREADY_ANSWERED");
    await tx.update(reviews).set({ proReply: reply, proRepliedAt: new Date() }).where(eq(reviews.id, review.id));
    return { id: review.id };
  });
}

export async function listReviewsForStaff(db: Database, input: { status?: "visible" | "hidden" } = {}) {
  const rows = await db.select().from(reviews).where(input.status ? eq(reviews.status, input.status) : undefined).orderBy(desc(reviews.id)).limit(200);
  return describe(db, rows);
}

/** Masquer un avis (injurieux, hors sujet, données personnelles) ou le réafficher ; la note est recalculée. */
export async function setReviewStatus(db: Database, actorUserId: number, input: { id: number; status: "visible" | "hidden"; note?: string }) {
  const note = input.note?.trim() || null;
  if (input.status === "hidden" && (!note || note.length < 3)) throw new BusinessError("REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [review] = await tx.select().from(reviews).where(eq(reviews.id, input.id)).limit(1).for("update");
    if (!review) throw new BusinessError("REVIEW_NOT_FOUND");
    if (review.status === input.status) throw new BusinessError("INVALID_TRANSITION");
    await tx.update(reviews).set({ status: input.status, moderationNote: note }).where(eq(reviews.id, review.id));
    await recompute(tx, review.professionalId);
    await tx.insert(auditLogs).values({ actorUserId, action: input.status === "hidden" ? "Avis masqué" : "Avis réaffiché", entityType: "review", entityId: String(review.id), metadata: JSON.stringify({ name: `Avis n° ${review.id} (${review.rating}/5)`, reason: note }) });
    return { id: review.id, status: input.status };
  });
}
