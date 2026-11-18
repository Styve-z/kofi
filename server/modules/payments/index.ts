import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { auditLogs, bookings, giftCards, payments, payouts, professionalProfiles } from "../../../drizzle/schema";
import { onGiftCardPayment, restoreGiftCard } from "../giftcards";
import { earnForBooking, restorePoints } from "../loyalty";
import type { Database } from "../../db";
import { normalizeCameroonPhone } from "../booking";
import { BusinessError } from "../errors";
import { notify, notifyProfessional } from "../notifications";
import { formatDoualaSlot } from "../time";
import { amountDue, commissionFor, getPaymentProvider, getPaymentSettings } from "./config";
import type { PaymentEvent } from "./provider";

/**
 * Circuit de paiement. Règles :
 *  - le client paie après l’acceptation par le professionnel (montant relu en base, jamais envoyé par le client) ;
 *  - seul l’événement du prestataire (webhook signé) fait passer un paiement à « réussi », une seule fois ;
 *  - toute réservation payée puis annulée ou refusée est remboursée intégralement ;
 *  - la commission KOFI est figée quand le rendez-vous est terminé.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type BookingRow = typeof bookings.$inferSelect;

/**
 * Appelé quand une réservation est confirmée : le montant dû est fixé si le paiement est actif.
 * La part déjà réglée par carte cadeau compte comme payée : la réservation peut être soldée d’emblée.
 */
export async function onBookingConfirmed(tx: Tx, booking: BookingRow) {
  const settings = getPaymentSettings();
  if (booking.totalXaf <= 0 || booking.paymentStatus !== "none") return;
  if (!settings.enabled) {
    if (booking.giftCardXaf > 0) await tx.update(bookings).set({ paymentStatus: booking.amountPaidXaf >= booking.totalXaf ? "paid" : "none", amountDueXaf: booking.totalXaf }).where(eq(bookings.id, booking.id));
    return;
  }
  const due = Math.max(amountDue(booking.totalXaf, settings), Math.min(booking.totalXaf, booking.amountPaidXaf));
  await tx.update(bookings).set({ paymentStatus: booking.amountPaidXaf >= due ? "paid" : "unpaid", amountDueXaf: due }).where(eq(bookings.id, booking.id));
}

/** Appelé quand un rendez-vous est terminé : commission figée sur le montant encaissé, points fidélité crédités. */
export async function onBookingCompleted(tx: Tx, booking: BookingRow) {
  if (booking.amountPaidXaf > 0) await tx.update(bookings).set({ commissionXaf: commissionFor(booking.amountPaidXaf) }).where(eq(bookings.id, booking.id));
  // Points visibles dans « Ma fidélité » (pas de notification séparée : le client reçoit déjà « donnez votre avis »).
  await earnForBooking(tx, booking);
}

export async function initiatePayment(db: Database, userId: number, input: { reference: string; operator: "mtn" | "orange"; phone: string }) {
  const provider = getPaymentProvider();
  if (!provider) throw new BusinessError("PAYMENTS_DISABLED");
  const phone = normalizeCameroonPhone(input.phone);
  if (!phone) throw new BusinessError("CUSTOMER_DETAILS_INVALID");
  const [booking] = await db.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1);
  if (!booking || booking.customerUserId !== userId) throw new BusinessError("BOOKING_NOT_FOUND");
  if (booking.status !== "confirmed" || booking.paymentStatus !== "unpaid") throw new BusinessError("PAYMENT_NOT_DUE");
  // Une demande déjà en cours (moins de 10 minutes) est réutilisée : pas de double débit sur deux clics.
  const [pending] = await db.select().from(payments).where(and(eq(payments.bookingId, booking.id), eq(payments.kind, "payment"), eq(payments.status, "pending"))).orderBy(desc(payments.id)).limit(1);
  if (pending && Date.now() - pending.createdAt.getTime() < 10 * 60_000) return { paymentId: pending.id, status: pending.status, instructions: "Une demande de paiement est déjà en cours : validez-la sur votre téléphone.", testMode: provider.test };
  const amount = booking.amountDueXaf - booking.amountPaidXaf;
  let result: { providerReference: string; instructions: string };
  try {
    result = await provider.initiate({ amountXaf: amount, phone, operator: input.operator, reference: booking.reference, description: `KOFI ${booking.reference}` });
  } catch (error) {
    console.error("[KOFI] Échec de la demande de paiement", error);
    throw new BusinessError("PAYMENT_PROVIDER_ERROR");
  }
  const [inserted] = await db.insert(payments).values({ bookingId: booking.id, kind: "payment", provider: provider.name, providerReference: result.providerReference, operator: input.operator, payerPhone: phone, amountXaf: amount, status: "pending" }).$returningId();
  return { paymentId: inserted.id, status: "pending" as const, instructions: result.instructions, testMode: provider.test };
}

/**
 * Applique un événement du prestataire. Idempotent : un paiement déjà terminé n’est jamais modifié,
 * et un événement inconnu est ignoré. Renvoie les remboursements à lancer (paiement reçu sur une
 * réservation entre-temps annulée).
 */
export async function applyPaymentEvent(db: Database, event: PaymentEvent) {
  const outcome = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.providerReference, event.providerReference)).limit(1).for("update");
    if (!payment) return { applied: false, reason: "unknown" as const, refundBookingId: null as number | null };
    if (payment.status !== "pending") return { applied: false, reason: "already_final" as const, refundBookingId: null };
    await tx.update(payments).set({ status: event.status, failureReason: event.status === "failed" ? event.failureReason ?? "Refusé par l’opérateur" : null, completedAt: new Date() }).where(eq(payments.id, payment.id));
    // Achat d’une carte cadeau : activation (ou annulation) de la carte, rien d’autre.
    if (payment.giftCardId) {
      await onGiftCardPayment(tx, payment.giftCardId, event.status, event.failureReason);
      return { applied: true, reason: "ok" as const, refundBookingId: null };
    }
    if (!payment.bookingId) return { applied: true, reason: "ok" as const, refundBookingId: null };
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1).for("update");
    const [pro] = await tx.select({ name: professionalProfiles.displayName }).from(professionalProfiles).where(eq(professionalProfiles.id, booking.professionalId)).limit(1);
    const when = formatDoualaSlot(booking.startsAt);
    if (payment.kind === "payment" && event.status === "succeeded") {
      const paid = booking.amountPaidXaf + payment.amountXaf;
      const cancelledMeanwhile = booking.status === "cancelled" || booking.status === "refused";
      await tx.update(bookings).set({ amountPaidXaf: paid, paymentStatus: cancelledMeanwhile ? "refund_pending" : paid >= booking.amountDueXaf ? "paid" : "unpaid" }).where(eq(bookings.id, booking.id));
      await notify(tx, { userId: booking.customerUserId, type: "payment.succeeded", title: "Paiement confirmé", body: `${payment.amountXaf.toLocaleString("fr-FR")} FCFA · ${pro?.name ?? ""} · ${when}`, link: "/mes-reservations" });
      if (!cancelledMeanwhile) await notifyProfessional(tx, booking.professionalId, { type: "payment.received", title: "Paiement reçu", body: `${booking.customerName} · ${when} · ${payment.amountXaf.toLocaleString("fr-FR")} FCFA`, link: "/professionnel" });
      return { applied: true, reason: "ok" as const, refundBookingId: cancelledMeanwhile ? booking.id : null };
    }
    if (payment.kind === "payment") {
      await notify(tx, { userId: booking.customerUserId, type: "payment.failed", title: "Paiement non abouti", body: `${event.failureReason ?? "Refusé par l’opérateur"}. Vous pouvez réessayer depuis vos réservations.`, link: "/mes-reservations" });
      return { applied: true, reason: "ok" as const, refundBookingId: null };
    }
    if (event.status === "succeeded") {
      const remaining = Math.max(0, booking.amountPaidXaf - payment.amountXaf);
      await tx.update(bookings).set({ amountPaidXaf: remaining, paymentStatus: remaining === 0 ? "refunded" : "refund_pending" }).where(eq(bookings.id, booking.id));
      await notify(tx, { userId: booking.customerUserId, type: "refund.succeeded", title: "Remboursement effectué", body: `${payment.amountXaf.toLocaleString("fr-FR")} FCFA renvoyés sur votre compte Mobile Money · réf. ${booking.reference}`, link: "/mes-reservations" });
    } else {
      // Remboursement refusé par le prestataire : l’équipe doit intervenir (visible dans le back-office).
      console.error(`[KOFI] Remboursement en échec pour ${booking.reference} : ${event.failureReason ?? "?"}`);
    }
    return { applied: true, reason: "ok" as const, refundBookingId: null };
  });
  if (outcome.refundBookingId) await startRefund(db, outcome.refundBookingId);
  return { applied: outcome.applied, reason: outcome.reason };
}

/** Rembourse intégralement les paiements réussis d’une réservation (après annulation ou refus). */
export async function startRefund(db: Database, bookingId: number) {
  const provider = getPaymentProvider();
  const succeeded = await db.select().from(payments).where(and(eq(payments.bookingId, bookingId), eq(payments.kind, "payment"), eq(payments.status, "succeeded")));
  const refunds = await db.select().from(payments).where(and(eq(payments.bookingId, bookingId), eq(payments.kind, "refund"), inArray(payments.status, ["pending", "succeeded"])));
  const alreadyRefunding = refunds.reduce((sum, refund) => sum + refund.amountXaf, 0);
  const paid = succeeded.reduce((sum, payment) => sum + payment.amountXaf, 0);
  if (paid - alreadyRefunding <= 0) return { started: 0 };
  await db.update(bookings).set({ paymentStatus: "refund_pending" }).where(eq(bookings.id, bookingId));
  if (!provider) return { started: 0 };
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  let started = 0;
  let toRefund = paid - alreadyRefunding;
  for (const payment of succeeded) {
    if (toRefund <= 0) break;
    const amount = Math.min(payment.amountXaf, toRefund);
    try {
      const result = await provider.refund({ providerReference: payment.providerReference, amountXaf: amount, reference: booking.reference });
      await db.insert(payments).values({ bookingId, kind: "refund", provider: provider.name, providerReference: result.providerReference, operator: payment.operator, payerPhone: payment.payerPhone, amountXaf: amount, status: "pending" });
      started += 1;
      toRefund -= amount;
    } catch (error) {
      console.error(`[KOFI] Remboursement impossible pour ${booking.reference}`, error);
    }
  }
  return { started };
}

export async function getPaymentForCustomer(db: Database, userId: number, paymentId: number) {
  const [row] = await db.select({ payment: payments, customerUserId: bookings.customerUserId, reference: bookings.reference, paymentStatus: bookings.paymentStatus }).from(payments).innerJoin(bookings, eq(bookings.id, payments.bookingId)).where(eq(payments.id, paymentId)).limit(1);
  if (!row || row.customerUserId !== userId) throw new BusinessError("PAYMENT_NOT_FOUND");
  return { id: row.payment.id, status: row.payment.status, failureReason: row.payment.failureReason, amountXaf: row.payment.amountXaf, reference: row.reference, bookingPaymentStatus: row.paymentStatus };
}

/** Mode test uniquement : simule la réponse de l’opérateur en passant par le même chemin qu’un webhook. */
export async function simulateTestPayment(db: Database, userId: number, input: { paymentId: number; outcome: "succeeded" | "failed" }) {
  const provider = getPaymentProvider();
  if (!provider?.test) throw new BusinessError("PAYMENTS_DISABLED");
  const [row] = await db.select({ payment: payments, customerUserId: bookings.customerUserId }).from(payments).innerJoin(bookings, eq(bookings.id, payments.bookingId)).where(eq(payments.id, input.paymentId)).limit(1);
  if (!row || row.customerUserId !== userId) throw new BusinessError("PAYMENT_NOT_FOUND");
  await applyPaymentEvent(db, { providerReference: row.payment.providerReference, status: input.outcome, failureReason: input.outcome === "failed" ? "Solde insuffisant (simulation)" : undefined });
  return getPaymentForCustomer(db, userId, input.paymentId);
}

/**
 * Mode test uniquement, pour l’équipe : simule la réponse de l’opérateur pour une opération en attente
 * (paiement ou remboursement), par le même chemin qu’un webhook signé.
 */
export async function simulateTestOperation(db: Database, actorUserId: number, input: { paymentId: number; outcome: "succeeded" | "failed" }) {
  const provider = getPaymentProvider();
  if (!provider?.test) throw new BusinessError("PAYMENTS_DISABLED");
  const [payment] = await db.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
  if (!payment) throw new BusinessError("PAYMENT_NOT_FOUND");
  if (payment.status !== "pending") return { id: payment.id, status: payment.status };
  await applyPaymentEvent(db, { providerReference: payment.providerReference, status: input.outcome, failureReason: input.outcome === "failed" ? "Refus de l’opérateur (simulation)" : undefined });
  await db.insert(auditLogs).values({ actorUserId, action: "Simulation de paiement (mode test)", entityType: "payment", entityId: String(payment.id), metadata: JSON.stringify({ note: `${payment.kind === "refund" ? "Remboursement" : "Paiement"} → ${input.outcome === "succeeded" ? "réussi" : "échoué"}` }) });
  const [updated] = await db.select({ id: payments.id, status: payments.status }).from(payments).where(eq(payments.id, payment.id)).limit(1);
  return updated;
}

// ---------------------------------------------------------------------------
// Comptes des professionnels et back-office
// ---------------------------------------------------------------------------

async function balances(db: Database, professionalIds?: number[]) {
  const earned = await db.select({ professionalId: bookings.professionalId, paid: sql<number>`coalesce(sum(${bookings.amountPaidXaf}), 0)`, commission: sql<number>`coalesce(sum(${bookings.commissionXaf}), 0)`, count: sql<number>`count(*)` })
    .from(bookings).where(and(eq(bookings.status, "completed"), gt(bookings.amountPaidXaf, 0), professionalIds ? inArray(bookings.professionalId, professionalIds) : undefined)).groupBy(bookings.professionalId);
  const paidOut = await db.select({ professionalId: payouts.professionalId, total: sql<number>`coalesce(sum(${payouts.amountXaf}), 0)` }).from(payouts).where(professionalIds ? inArray(payouts.professionalId, professionalIds) : undefined).groupBy(payouts.professionalId);
  return earned.map((row) => {
    const net = Number(row.paid) - Number(row.commission);
    const out = Number(paidOut.find((item) => item.professionalId === row.professionalId)?.total ?? 0);
    return { professionalId: row.professionalId, completedPaid: Number(row.count), collectedXaf: Number(row.paid), commissionXaf: Number(row.commission), netXaf: net, paidOutXaf: out, balanceXaf: net - out };
  });
}

export async function getMyEarnings(db: Database, userId: number) {
  const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
  const [row] = await balances(db, [profile.id]);
  const history = await db.select().from(payouts).where(eq(payouts.professionalId, profile.id)).orderBy(desc(payouts.id)).limit(20);
  const settings = getPaymentSettings();
  return {
    enabled: settings.enabled, commissionPercent: settings.commissionPercent,
    collectedXaf: row?.collectedXaf ?? 0, commissionXaf: row?.commissionXaf ?? 0, netXaf: row?.netXaf ?? 0, paidOutXaf: row?.paidOutXaf ?? 0, balanceXaf: row?.balanceXaf ?? 0,
    payouts: history.map((item) => ({ id: item.id, amountXaf: item.amountXaf, note: item.note, createdAt: item.createdAt.toISOString() })),
  };
}

export async function listPaymentsForStaff(db: Database, input: { status?: "pending" | "succeeded" | "failed"; kind?: "payment" | "refund" } = {}) {
  const filters = [];
  if (input.status) filters.push(eq(payments.status, input.status));
  if (input.kind) filters.push(eq(payments.kind, input.kind));
  const rows = await db.select({ payment: payments, reference: bookings.reference, customerName: bookings.customerName, professionalId: bookings.professionalId }).from(payments).innerJoin(bookings, eq(bookings.id, payments.bookingId)).where(filters.length ? and(...filters) : undefined).orderBy(desc(payments.id)).limit(200);
  const pros = await db.select({ id: professionalProfiles.id, name: professionalProfiles.displayName, slug: professionalProfiles.slug }).from(professionalProfiles);
  const [totals] = await db.select({
    collected: sql<number>`coalesce(sum(case when ${payments.kind} = 'payment' and ${payments.status} = 'succeeded' then ${payments.amountXaf} else 0 end), 0)`,
    refunded: sql<number>`coalesce(sum(case when ${payments.kind} = 'refund' and ${payments.status} = 'succeeded' then ${payments.amountXaf} else 0 end), 0)`,
    refundsPending: sql<number>`coalesce(sum(case when ${payments.kind} = 'refund' and ${payments.status} = 'pending' then 1 else 0 end), 0)`,
    refundsFailed: sql<number>`coalesce(sum(case when ${payments.kind} = 'refund' and ${payments.status} = 'failed' then 1 else 0 end), 0)`,
  }).from(payments);
  const proBalances = (await balances(db)).map((row) => ({ ...row, professional: pros.find((pro) => pro.id === row.professionalId) ?? null })).sort((a, b) => b.balanceXaf - a.balanceXaf);
  return {
    settings: getPaymentSettings(),
    totals: { collectedXaf: Number(totals.collected), refundedXaf: Number(totals.refunded), refundsPending: Number(totals.refundsPending), refundsFailed: Number(totals.refundsFailed) },
    items: rows.map((row) => ({ id: row.payment.id, kind: row.payment.kind, status: row.payment.status, amountXaf: row.payment.amountXaf, operator: row.payment.operator, provider: row.payment.provider, providerReference: row.payment.providerReference, failureReason: row.payment.failureReason, createdAt: row.payment.createdAt.toISOString(), reference: row.reference, customerName: row.customerName, professional: pros.find((pro) => pro.id === row.professionalId)?.name ?? "—" })),
    balances: proBalances,
  };
}

/** Enregistre un reversement fait au professionnel ; ne peut pas dépasser son solde. */
export async function recordPayout(db: Database, actorUserId: number, input: { slug: string; amountXaf: number; note?: string }) {
  if (!Number.isInteger(input.amountXaf) || input.amountXaf <= 0) throw new BusinessError("PAYOUT_INVALID");
  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(professionalProfiles).where(eq(professionalProfiles.slug, input.slug)).limit(1).for("update");
    if (!profile) throw new BusinessError("PROFESSIONAL_NOT_FOUND");
    const [row] = await balances(tx as unknown as Database, [profile.id]);
    if (!row || input.amountXaf > row.balanceXaf) throw new BusinessError("PAYOUT_INVALID");
    const note = input.note?.trim().slice(0, 255) || null;
    await tx.insert(payouts).values({ professionalId: profile.id, amountXaf: input.amountXaf, note, createdByUserId: actorUserId });
    await tx.insert(auditLogs).values({ actorUserId, action: "Reversement enregistré", entityType: "payout", entityId: profile.slug, metadata: JSON.stringify({ name: profile.displayName, note: `${input.amountXaf.toLocaleString("fr-FR")} FCFA${note ? ` · ${note}` : ""}` }) });
    await notify(tx, { userId: profile.ownerUserId, type: "payout.sent", title: "Reversement envoyé", body: `${input.amountXaf.toLocaleString("fr-FR")} FCFA${note ? ` · ${note}` : ""}`, link: "/professionnel" });
    return { balanceXaf: row.balanceXaf - input.amountXaf };
  });
}

/**
 * Appelé quand une réservation est annulée ou refusée. Sans paiement reçu, plus rien n’est dû ;
 * avec un paiement reçu, renvoie true : le remboursement est lancé après la transaction.
 */
export async function onBookingClosed(tx: Tx, booking: BookingRow) {
  // Points fidélité utilisés : rendus. Part payée par carte cadeau : recréditée sur la carte.
  await restorePoints(tx, booking);
  const restored = await restoreGiftCard(tx, booking);
  const paidByMobileMoney = booking.amountPaidXaf - restored;
  if (paidByMobileMoney > 0) return true;
  if (booking.paymentStatus === "unpaid" || restored > 0) await tx.update(bookings).set({ paymentStatus: "none" }).where(eq(bookings.id, booking.id));
  return false;
}

/** Mode test : simule la réponse de l’opérateur pour l’achat d’une carte cadeau. */
export async function simulateGiftCardTestPayment(db: Database, userId: number, input: { paymentId: number; outcome: "succeeded" | "failed" }) {
  const provider = getPaymentProvider();
  if (!provider?.test) throw new BusinessError("PAYMENTS_DISABLED");
  const [row] = await db.select({ payment: payments, purchaserUserId: giftCards.purchaserUserId }).from(payments).innerJoin(giftCards, eq(giftCards.id, payments.giftCardId)).where(eq(payments.id, input.paymentId)).limit(1);
  if (!row || row.purchaserUserId !== userId) throw new BusinessError("PAYMENT_NOT_FOUND");
  await applyPaymentEvent(db, { providerReference: row.payment.providerReference, status: input.outcome, failureReason: input.outcome === "failed" ? "Solde insuffisant (simulation)" : undefined });
  return { ok: true as const };
}
