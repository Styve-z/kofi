import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { bookings, promotions, type Promotion } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";

/**
 * Codes promo. L’utilisation d’un code est comptée à partir des réservations actives
 * (ni annulées, ni refusées) : une annulation libère donc automatiquement l’utilisation,
 * sans compteur susceptible de dériver.
 */

type Executor = Pick<Database, "select">;
const INACTIVE = ["cancelled", "refused"] as ("cancelled" | "refused")[];

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export function computeDiscount(promotion: Pick<Promotion, "discountType" | "discountValue">, subtotalXaf: number) {
  const raw = promotion.discountType === "percentage" ? Math.round((subtotalXaf * promotion.discountValue) / 100) : promotion.discountValue;
  return Math.max(0, Math.min(raw, subtotalXaf));
}

async function usage(db: Executor, promotionId: number, customerUserId?: number | null) {
  const filters = [eq(bookings.promotionId, promotionId), notInArray(bookings.status, INACTIVE)];
  if (customerUserId) filters.push(eq(bookings.customerUserId, customerUserId));
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(bookings).where(and(...filters));
  return Number(row.count);
}

/**
 * Vérifie un code pour un montant et un client donnés, et renvoie la remise.
 * Dans une réservation, appeler avec `lock: true` dans la transaction : la ligne du code est
 * verrouillée, ce qui empêche de dépasser `maxUses` quand plusieurs clients l’utilisent en même temps.
 */
export async function evaluatePromo(db: Executor, input: { code: string; subtotalXaf: number; customerUserId: number | null; now?: Date; lock?: boolean }) {
  const code = normalizeCode(input.code);
  if (!code) throw new BusinessError("PROMO_INVALID");
  const query = db.select().from(promotions).where(eq(promotions.code, code)).limit(1);
  const [promotion] = input.lock ? await query.for("update") : await query;
  if (!promotion || promotion.isEnabled !== 1) throw new BusinessError("PROMO_INVALID");
  const now = input.now ?? new Date();
  if (now < promotion.startsAt || now > promotion.endsAt) throw new BusinessError("PROMO_EXPIRED");
  if (input.subtotalXaf < promotion.minSubtotalXaf) throw new BusinessError("PROMO_MIN_TOTAL");
  if (promotion.maxUses !== null && (await usage(db, promotion.id)) >= promotion.maxUses) throw new BusinessError("PROMO_EXHAUSTED");
  if (promotion.onePerCustomer === 1 && input.customerUserId && (await usage(db, promotion.id, input.customerUserId)) > 0) throw new BusinessError("PROMO_ALREADY_USED");
  const discountXaf = computeDiscount(promotion, input.subtotalXaf);
  return { promotion, code: promotion.code, label: promotion.label, discountXaf, totalXaf: input.subtotalXaf - discountXaf };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export type PromotionInput = {
  code: string; label: string; discountType: "fixed" | "percentage"; discountValue: number;
  startsAt: string; endsAt: string; maxUses?: number | null; onePerCustomer: boolean; minSubtotalXaf?: number;
};

export function validatePromotionInput(input: PromotionInput) {
  const code = normalizeCode(input.code);
  const starts = new Date(input.startsAt);
  const ends = new Date(input.endsAt);
  const valueOk = input.discountType === "percentage" ? input.discountValue >= 1 && input.discountValue <= 90 : input.discountValue >= 100 && input.discountValue <= 100_000;
  if (!/^[A-Z0-9-]{3,20}$/.test(code) || input.label.trim().length < 3 || !valueOk || !(ends > starts) || (input.maxUses ?? 1) < 1 || (input.minSubtotalXaf ?? 0) < 0) throw new BusinessError("PROMO_INPUT_INVALID");
  return { code, label: input.label.trim(), discountType: input.discountType, discountValue: input.discountValue, startsAt: starts, endsAt: ends, maxUses: input.maxUses ?? null, onePerCustomer: input.onePerCustomer ? 1 : 0, minSubtotalXaf: input.minSubtotalXaf ?? 0 };
}

export async function listPromotions(db: Database, now = new Date()) {
  const rows = await db.select().from(promotions).orderBy(desc(promotions.id)).limit(200);
  const usages = rows.length ? await db.select({ id: bookings.promotionId, count: sql<number>`count(*)`, discount: sql<number>`coalesce(sum(${bookings.discountXaf}), 0)` }).from(bookings).where(notInArray(bookings.status, INACTIVE)).groupBy(bookings.promotionId) : [];
  return rows.map((row) => {
    const used = usages.find((item) => item.id === row.id);
    const state = row.isEnabled !== 1 ? "disabled" : now < row.startsAt ? "scheduled" : now > row.endsAt ? "expired" : row.maxUses !== null && Number(used?.count ?? 0) >= row.maxUses ? "exhausted" : "active";
    return {
      id: row.id, code: row.code, label: row.label, discountType: row.discountType, discountValue: row.discountValue,
      startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), maxUses: row.maxUses, onePerCustomer: row.onePerCustomer === 1,
      minSubtotalXaf: row.minSubtotalXaf, enabled: row.isEnabled === 1, uses: Number(used?.count ?? 0), discountGivenXaf: Number(used?.discount ?? 0), state,
    };
  });
}
