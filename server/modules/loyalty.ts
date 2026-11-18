import { desc, eq, sql } from "drizzle-orm";
import { bookings, loyaltyLedger, users } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";

/**
 * Programme fidélité :
 *  - 1 point gagné par tranche de 100 FCFA d’un rendez-vous TERMINÉ (montant après réductions) ;
 *  - les points s’utilisent par paquets de 100 : 100 points = 500 FCFA de réduction ;
 *  - la réduction ne dépasse pas la moitié du montant à payer ;
 *  - points utilisés sur une réservation annulée ou refusée : rendus automatiquement.
 * Le solde est la somme du journal (jamais un compteur modifiable directement).
 */
export const LOYALTY = { earnPer: 100, blockPoints: 100, blockValueXaf: 500, maxShare: 0.5 } as const;

type Executor = Pick<Database, "select" | "insert" | "update">;
type BookingRow = typeof bookings.$inferSelect;

export async function loyaltyBalance(db: Pick<Database, "select">, userId: number) {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${loyaltyLedger.points}), 0)` }).from(loyaltyLedger).where(eq(loyaltyLedger.userId, userId));
  return Number(row?.total ?? 0);
}

export const pointsValueXaf = (points: number) => Math.floor(points / LOYALTY.blockPoints) * LOYALTY.blockValueXaf;
export const pointsEarnedFor = (amountXaf: number) => Math.max(0, Math.floor(amountXaf / LOYALTY.earnPer));

/** Plus grand nombre de points utilisables (multiple de 100) pour un montant donné et un solde donné. */
export function maxUsablePoints(balance: number, amountXaf: number) {
  const byAmount = Math.floor((amountXaf * LOYALTY.maxShare) / LOYALTY.blockValueXaf) * LOYALTY.blockPoints;
  const byBalance = Math.floor(balance / LOYALTY.blockPoints) * LOYALTY.blockPoints;
  return Math.max(0, Math.min(byAmount, byBalance));
}

/**
 * Débite des points pour une réservation (dans la transaction de création).
 * La ligne de l’utilisateur est verrouillée : deux réservations simultanées ne peuvent pas dépenser les mêmes points.
 */
export async function spendPoints(tx: Executor & Pick<Database, "select">, userId: number, points: number, amountXaf: number) {
  if (!points) return { points: 0, discountXaf: 0 };
  if (!Number.isInteger(points) || points < 0 || points % LOYALTY.blockPoints !== 0) throw new BusinessError("LOYALTY_INVALID");
  await (tx as Database).select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("update");
  const balance = await loyaltyBalance(tx, userId);
  if (points > maxUsablePoints(balance, amountXaf)) throw new BusinessError("LOYALTY_INVALID");
  return { points, discountXaf: pointsValueXaf(points) };
}

export async function recordSpend(tx: Executor, userId: number, bookingId: number, points: number) {
  if (points > 0) await tx.insert(loyaltyLedger).values({ userId, bookingId, points: -points, reason: "Points utilisés pour une réservation" });
}

/** Rendez-vous terminé : crédite les points une seule fois. */
export async function earnForBooking(tx: Executor, booking: BookingRow) {
  if (!booking.customerUserId || booking.loyaltyEarned > 0) return 0;
  const points = pointsEarnedFor(booking.totalXaf);
  if (!points) return 0;
  await tx.insert(loyaltyLedger).values({ userId: booking.customerUserId, bookingId: booking.id, points, reason: `Rendez-vous terminé · réf. ${booking.reference}` });
  await tx.update(bookings).set({ loyaltyEarned: points }).where(eq(bookings.id, booking.id));
  return points;
}

/** Réservation annulée ou refusée : les points utilisés sont rendus. */
export async function restorePoints(tx: Executor, booking: BookingRow) {
  if (!booking.customerUserId || booking.loyaltyPointsUsed <= 0) return;
  await tx.insert(loyaltyLedger).values({ userId: booking.customerUserId, bookingId: booking.id, points: booking.loyaltyPointsUsed, reason: `Points rendus · réf. ${booking.reference} annulée` });
  await tx.update(bookings).set({ loyaltyPointsUsed: 0 }).where(eq(bookings.id, booking.id));
}

export async function getMyLoyalty(db: Database, userId: number) {
  const balance = await loyaltyBalance(db, userId);
  const history = await db.select().from(loyaltyLedger).where(eq(loyaltyLedger.userId, userId)).orderBy(desc(loyaltyLedger.id)).limit(50);
  return {
    balance,
    valueXaf: pointsValueXaf(balance),
    rules: { ...LOYALTY },
    history: history.map((row) => ({ id: row.id, points: row.points, reason: row.reason, createdAt: row.createdAt.toISOString() })),
  };
}
