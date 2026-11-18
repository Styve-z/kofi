import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { bookings, giftCards, payments } from "../../drizzle/schema";
import type { Database } from "../db";
import { normalizeCameroonPhone } from "./booking";
import { BusinessError } from "./errors";
import { notify } from "./notifications";
import { getPaymentProvider } from "./payments/config";

/**
 * Cartes cadeaux KOFI :
 *  - achetées par Mobile Money (5 000 à 200 000 FCFA), valables 1 an ;
 *  - le code n’est révélé qu’une fois le paiement confirmé par l’opérateur ;
 *  - utilisables en une ou plusieurs fois pour payer un rendez-vous (le montant utilisé compte comme déjà payé) ;
 *  - si le rendez-vous est annulé ou refusé, le montant utilisé est recrédité sur la carte.
 */
export const GIFT_CARD = { minXaf: 5_000, maxXaf: 200_000, validityDays: 365 } as const;

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type BookingRow = typeof bookings.$inferSelect;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I, pour éviter les confusions
function newCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `KDO-${part()}-${part()}`;
}

export const normalizeGiftCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export async function purchaseGiftCard(db: Database, userId: number, input: { amountXaf: number; recipientName?: string; message?: string; operator: "mtn" | "orange"; phone: string }) {
  const provider = getPaymentProvider();
  if (!provider) throw new BusinessError("PAYMENTS_DISABLED");
  if (!Number.isInteger(input.amountXaf) || input.amountXaf < GIFT_CARD.minXaf || input.amountXaf > GIFT_CARD.maxXaf || input.amountXaf % 500 !== 0) throw new BusinessError("GIFT_CARD_INVALID");
  const phone = normalizeCameroonPhone(input.phone);
  if (!phone) throw new BusinessError("CUSTOMER_DETAILS_INVALID");
  const code = newCode();
  const expiresAt = new Date(Date.now() + GIFT_CARD.validityDays * 86_400_000);
  const [card] = await db.insert(giftCards).values({ code, initialXaf: input.amountXaf, balanceXaf: input.amountXaf, purchaserUserId: userId, recipientName: input.recipientName?.trim().slice(0, 120) || null, message: input.message?.trim().slice(0, 300) || null, status: "pending_payment", expiresAt }).$returningId();
  let result: { providerReference: string; instructions: string };
  try {
    result = await provider.initiate({ amountXaf: input.amountXaf, phone, operator: input.operator, reference: `GIFT-${card.id}`, description: "Carte cadeau KOFI" });
  } catch (error) {
    console.error("[KOFI] Échec de la demande de paiement (carte cadeau)", error);
    await db.update(giftCards).set({ status: "cancelled" }).where(eq(giftCards.id, card.id));
    throw new BusinessError("PAYMENT_PROVIDER_ERROR");
  }
  const [payment] = await db.insert(payments).values({ giftCardId: card.id, kind: "payment", provider: provider.name, providerReference: result.providerReference, operator: input.operator, payerPhone: phone, amountXaf: input.amountXaf, status: "pending" }).$returningId();
  return { giftCardId: card.id, paymentId: payment.id, instructions: result.instructions, testMode: provider.test };
}

/** Appelé par le circuit de paiement (webhook ou simulation) pour un paiement de carte cadeau. */
export async function onGiftCardPayment(tx: Tx, giftCardId: number, status: "succeeded" | "failed", failureReason?: string) {
  const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, giftCardId)).limit(1).for("update");
  if (!card || card.status !== "pending_payment") return;
  if (status === "succeeded") {
    await tx.update(giftCards).set({ status: "active", activatedAt: new Date() }).where(eq(giftCards.id, card.id));
    await notify(tx, { userId: card.purchaserUserId, type: "giftcard.active", title: "Votre carte cadeau est prête 🎁", body: `Code ${card.code} · ${card.initialXaf.toLocaleString("fr-FR")} FCFA${card.recipientName ? ` pour ${card.recipientName}` : ""}`, link: "/cartes-cadeaux" });
  } else {
    await tx.update(giftCards).set({ status: "cancelled" }).where(eq(giftCards.id, card.id));
    await notify(tx, { userId: card.purchaserUserId, type: "giftcard.failed", title: "Paiement de la carte cadeau non abouti", body: failureReason ?? "Refusé par l’opérateur. Vous pouvez réessayer.", link: "/cartes-cadeaux" });
  }
}

/** Carte utilisable : active, non expirée, avec un solde. */
export async function lockUsableCard(tx: Tx, code: string, now = new Date()) {
  const [card] = await tx.select().from(giftCards).where(eq(giftCards.code, normalizeGiftCode(code))).limit(1).for("update");
  if (!card || card.status !== "active" || card.expiresAt < now || card.balanceXaf <= 0) throw new BusinessError("GIFT_CARD_INVALID");
  return card;
}

export async function debitCard(tx: Tx, cardId: number, amountXaf: number) {
  const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, cardId)).limit(1);
  await tx.update(giftCards).set({ balanceXaf: card.balanceXaf - amountXaf }).where(eq(giftCards.id, cardId));
}

/** Réservation annulée ou refusée : la part payée par carte est recréditée (et retirée du « déjà payé »). */
export async function restoreGiftCard(tx: Tx, booking: BookingRow) {
  if (!booking.giftCardId || booking.giftCardXaf <= 0) return 0;
  const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, booking.giftCardId)).limit(1).for("update");
  if (card) await tx.update(giftCards).set({ balanceXaf: card.balanceXaf + booking.giftCardXaf }).where(eq(giftCards.id, card.id));
  const remainingPaid = Math.max(0, booking.amountPaidXaf - booking.giftCardXaf);
  await tx.update(bookings).set({ giftCardXaf: 0, amountPaidXaf: remainingPaid, paymentStatus: remainingPaid > 0 ? booking.paymentStatus : "none" }).where(eq(bookings.id, booking.id));
  await notify(tx, { userId: booking.customerUserId, type: "giftcard.restored", title: "Carte cadeau recréditée", body: `${booking.giftCardXaf.toLocaleString("fr-FR")} FCFA rendus sur votre carte · réf. ${booking.reference}`, link: "/cartes-cadeaux" });
  return booking.giftCardXaf;
}

/** Vérification d’un code avant réservation (solde affiché au client connecté). */
export async function checkGiftCard(db: Database, code: string, now = new Date()) {
  const [card] = await db.select().from(giftCards).where(eq(giftCards.code, normalizeGiftCode(code))).limit(1);
  if (!card || card.status !== "active" || card.expiresAt < now || card.balanceXaf <= 0) return { valid: false as const };
  return { valid: true as const, code: card.code, balanceXaf: card.balanceXaf, expiresAt: card.expiresAt.toISOString() };
}

export async function listMyGiftCards(db: Database, userId: number) {
  const rows = await db.select().from(giftCards).where(eq(giftCards.purchaserUserId, userId)).orderBy(desc(giftCards.id)).limit(50);
  const pendingPayments = await db.select({ id: payments.id, giftCardId: payments.giftCardId }).from(payments).where(and(eq(payments.kind, "payment"), eq(payments.status, "pending")));
  return rows.filter((row) => row.status !== "cancelled" || row.activatedAt).map((row) => ({
    id: row.id,
    // Le code reste secret tant que la carte n’est pas payée.
    code: row.status === "active" ? row.code : null,
    status: row.expiresAt < new Date() && row.status === "active" ? ("expired" as const) : row.status,
    initialXaf: row.initialXaf, balanceXaf: row.balanceXaf, recipientName: row.recipientName, message: row.message,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
    pendingPaymentId: pendingPayments.find((payment) => payment.giftCardId === row.id)?.id ?? null,
  }));
}

export async function getGiftCardPayment(db: Database, userId: number, paymentId: number) {
  const [row] = await db.select({ payment: payments, purchaserUserId: giftCards.purchaserUserId, cardStatus: giftCards.status }).from(payments).innerJoin(giftCards, eq(giftCards.id, payments.giftCardId)).where(eq(payments.id, paymentId)).limit(1);
  if (!row || row.purchaserUserId !== userId) throw new BusinessError("PAYMENT_NOT_FOUND");
  return { id: row.payment.id, status: row.payment.status, failureReason: row.payment.failureReason, amountXaf: row.payment.amountXaf, cardStatus: row.cardStatus };
}
