import { and, desc, eq, gt, inArray, lt, lte, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { availabilitySlots, bookingEvents, bookingItems, bookings, professionalProfiles, promotions, reviews, serviceCatalog } from "../../drizzle/schema";
import { isReviewable } from "./reviews";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { getPaymentSettings } from "./payments/config";
import { onBookingClosed, startRefund } from "./payments/index";
import { evaluatePromo, normalizeCode } from "./promo";
import { notifyProfessional } from "./notifications";
import { extendHorizon } from "./schedule";
import { formatDoualaSlot } from "./time";
import { activeRules, offpeakDiscountXaf, offpeakPercentAt } from "./offpeak";
import { freeStaffFor, staffCandidates } from "./staff";
import { recordSpend, spendPoints } from "./loyalty";
import { debitCard, lockUsableCard } from "./giftcards";
import { staffMembers } from "../../drizzle/schema";

export type BookingStatus = "pending" | "confirmed" | "refused" | "cancelled" | "completed" | "no_show";

export type CreateBookingInput = {
  customerUserId: number | null;
  professionalSlug: string;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  mode: "salon" | "domicile";
  customerName: string;
  customerPhone: string;
  address?: string;
  serviceIds: string[];
  totalXaf: number;
  notes?: string;
  promoCode?: string;
  /** Collaborateur choisi ; absent = « peu importe » (attribution automatique d’une personne libre). */
  staffMemberId?: number | null;
  /** Points fidélité à utiliser (multiple de 100). */
  loyaltyPoints?: number;
  /** Code de carte cadeau pour régler tout ou partie du rendez-vous. */
  giftCardCode?: string;
};

export type BookingView = {
  reference: string;
  professional: { slug: string; name: string; salon: string; city: string; neighborhood: string };
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: "salon" | "domicile";
  address: string | null;
  customerName: string;
  customerPhone: string;
  notes: string | null;
  subtotalXaf: number;
  discountXaf: number;
  promoCode: string | null;
  totalXaf: number;
  paymentStatus: "none" | "unpaid" | "paid" | "refund_pending" | "refunded";
  amountDueXaf: number;
  amountPaidXaf: number;
  durationMinutes: number;
  status: BookingStatus;
  createdAt: string;
  items: { serviceId: string; name: string; durationMinutes: number; priceXaf: number }[];
  /** Avis laissé par le client, ou possibilité d’en laisser un (rendez-vous terminé depuis moins de 30 jours). */
  review: { rating: number } | null;
  canReview: boolean;
  staff: { id: number; name: string } | null;
  offpeakPercent: number;
  offpeakDiscountXaf: number;
  loyaltyPointsUsed: number;
  loyaltyDiscountXaf: number;
  giftCardXaf: number;
  /** Le client peut déplacer ce rendez-vous (mêmes délais que l’annulation gratuite). */
  canReschedule: boolean;
  events: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
};

const ACTIVE_STATUSES: BookingStatus[] = ["pending", "confirmed"];
type Executor = Pick<Database, "select" | "insert" | "update">;

/**
 * Numéro camerounais : 9 chiffres commençant par 6 (mobile) ou 2 (fixe),
 * avec ou sans indicatif 237 / +237. Renvoie la forme +237XXXXXXXXX ou null.
 */
export function normalizeCameroonPhone(raw: string): string | null {
  const digits = raw.replace(/[\s.\-()]/g, "").replace(/^\+/, "").replace(/^00/, "");
  const local = digits.startsWith("237") && digits.length === 12 ? digits.slice(3) : digits;
  return /^[62]\d{8}$/.test(local) ? `+237${local}` : null;
}

/** Charge le professionnel et les prestations choisies, et calcule durée, temps de préparation et total côté serveur. */
export async function resolveSelection(db: Executor, slug: string, serviceCodes: string[]) {
  const [professional] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.slug, slug)).limit(1);
  if (!professional || (professional.verificationStatus !== "pending" && professional.verificationStatus !== "verified")) throw new BusinessError("PROFESSIONAL_NOT_FOUND");
  const codes = [...new Set(serviceCodes)];
  if (!codes.length || codes.length !== serviceCodes.length) throw new BusinessError("SERVICE_NOT_FOUND");
  const services = await db.select().from(serviceCatalog).where(and(eq(serviceCatalog.professionalId, professional.id), inArray(serviceCatalog.code, codes), eq(serviceCatalog.isActive, 1)));
  if (services.length !== codes.length) throw new BusinessError("SERVICE_NOT_FOUND");
  const ordered = codes.map((code) => services.find((service) => service.code === code)!);
  const durationMinutes = ordered.reduce((sum, service) => sum + service.durationMinutes, 0);
  const preparationMinutes = ordered.reduce((sum, service) => sum + service.preparationMinutes, 0);
  const totalXaf = ordered.reduce((sum, service) => sum + service.priceXaf, 0);
  return { professional, services: ordered, durationMinutes, preparationMinutes, totalXaf };
}

/** Le créneau doit tenir dans une plage ouverte et ne toucher aucune indisponibilité. */
async function assertWithinAvailability(db: Executor, professionalId: number, starts: Date, ends: Date) {
  const openWindow = await db.select({ id: availabilitySlots.id }).from(availabilitySlots).where(and(eq(availabilitySlots.professionalId, professionalId), eq(availabilitySlots.status, "open"), lte(availabilitySlots.startsAt, starts), gte(availabilitySlots.endsAt, ends))).limit(1);
  if (!openWindow.length) throw new BusinessError("SLOT_OUTSIDE_HOURS");
  const closure = await db.select({ id: availabilitySlots.id }).from(availabilitySlots).where(and(eq(availabilitySlots.professionalId, professionalId), inArray(availabilitySlots.status, ["blocked", "leave", "holiday"]), lt(availabilitySlots.startsAt, ends), gt(availabilitySlots.endsAt, starts))).limit(1);
  if (closure.length) throw new BusinessError("SLOT_OUTSIDE_HOURS");
}

function newReference() {
  return `KOFI-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
}

/**
 * Crée une demande de réservation dans une transaction.
 * La ligne du professionnel est verrouillée (SELECT … FOR UPDATE) : deux demandes
 * simultanées pour le même professionnel sont traitées l’une après l’autre, ce qui
 * empêche le double-booking même sous forte concurrence.
 */
export async function createBooking(db: Database, input: CreateBookingInput, now = new Date()): Promise<BookingView> {
  const customerName = input.customerName.trim();
  const customerPhone = normalizeCameroonPhone(input.customerPhone);
  if (customerName.length < 2 || !customerPhone) throw new BusinessError("CUSTOMER_DETAILS_INVALID");
  const starts = new Date(input.startsAt);
  if (!Number.isFinite(starts.getTime())) throw new BusinessError("INVALID_TIME_RANGE");
  if (starts.getTime() <= now.getTime()) throw new BusinessError("SLOT_IN_PAST");
  // L’adresse ne concerne que les rendez-vous à domicile : elle n’est pas conservée pour le salon.
  const address = input.mode === "domicile" ? input.address?.trim() || null : null;

  const reference = await db.transaction(async (tx) => {
    // 1er ordre de la transaction : verrou sur le professionnel. Les demandes concurrentes
    // attendent ici, puis relisent l’état à jour (les lectures suivantes sont postérieures au verrou).
    const locked = await tx.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.slug, input.professionalSlug)).limit(1).for("update");
    if (!locked.length) throw new BusinessError("PROFESSIONAL_NOT_FOUND");
    // Puis verrou sur le code promo, toujours dans cet ordre (professionnel → code) pour éviter les interblocages,
    // et AVANT toute lecture simple : la vue de lecture de la transaction est ainsi postérieure aux deux verrous,
    // et le comptage des utilisations du code voit les réservations déjà validées par les autres clients.
    if (input.promoCode?.trim()) await tx.select({ id: promotions.id }).from(promotions).where(eq(promotions.code, normalizeCode(input.promoCode))).limit(1).for("update");
    const selection = await resolveSelection(tx, input.professionalSlug, input.serviceIds);
    const { professional } = selection;
    if (input.durationMinutes !== selection.durationMinutes) throw new BusinessError("DURATION_MISMATCH");
    if (input.totalXaf !== selection.totalXaf) throw new BusinessError("TOTAL_MISMATCH");
    if ((input.mode === "salon" && professional.mode === "domicile") || (input.mode === "domicile" && professional.mode === "salon")) throw new BusinessError("MODE_UNAVAILABLE");
    if (input.mode === "domicile" && (!address || address.length < 5)) throw new BusinessError("ADDRESS_REQUIRED");

    // Horizon d’ouverture prolongé si besoin (le professionnel est déjà verrouillé).
    await extendHorizon(tx, professional.id, professional.weeklyHours, now);

    // Occupation réelle = prestations + temps de préparation.
    const ends = new Date(starts.getTime() + (selection.durationMinutes + selection.preparationMinutes) * 60_000);

    await assertWithinAvailability(tx, professional.id, starts, ends);
    // Agenda : un seul si le salon n’a pas d’équipe, sinon un par collaborateur (attribution automatique si « peu importe »).
    const { candidates } = await staffCandidates(tx, professional.id, input.staffMemberId);
    const overlapping = await tx.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt, staffMemberId: bookings.staffMemberId }).from(bookings).where(and(eq(bookings.professionalId, professional.id), inArray(bookings.status, ACTIVE_STATUSES), lt(bookings.startsAt, ends), gt(bookings.endsAt, starts))).for("update");
    const freeStaff = freeStaffFor(candidates, overlapping, starts.getTime(), ends.getTime());
    if (!freeStaff.length) throw new BusinessError("SLOT_UNAVAILABLE");
    const staffMemberId = freeStaff[0];

    // Réductions, dans cet ordre : heures creuses → code promo → points fidélité. Tout est recalculé ici.
    const offpeakPercent = offpeakPercentAt((await activeRules(tx, [professional.id])).get(professional.id) ?? [], starts);
    const offpeakXaf = offpeakDiscountXaf(selection.totalXaf, offpeakPercent);
    // Code promo éventuel : vérifié et compté dans la même transaction (ligne du code verrouillée).
    const promo = input.promoCode?.trim() ? await evaluatePromo(tx, { code: input.promoCode, subtotalXaf: selection.totalXaf - offpeakXaf, customerUserId: input.customerUserId, now, lock: true }) : null;
    const afterDiscounts = selection.totalXaf - offpeakXaf - (promo?.discountXaf ?? 0);
    const loyalty = input.loyaltyPoints && input.customerUserId ? await spendPoints(tx, input.customerUserId, input.loyaltyPoints, afterDiscounts) : { points: 0, discountXaf: 0 };
    const total = afterDiscounts - loyalty.discountXaf;
    // Carte cadeau : réglée tout de suite (part comptée comme « déjà payée »).
    const card = input.giftCardCode?.trim() ? await lockUsableCard(tx, input.giftCardCode, now) : null;
    const giftXaf = card ? Math.min(card.balanceXaf, total) : 0;
    if (card && giftXaf > 0) await debitCard(tx, card.id, giftXaf);

    const ref = newReference();
    const [inserted] = await tx.insert(bookings).values({
      reference: ref, customerUserId: input.customerUserId, professionalId: professional.id, startsAt: starts, endsAt: ends,
      timezone: professional.timezone, mode: input.mode, address, customerName, customerPhone,
      notes: input.notes?.trim() || null, subtotalXaf: selection.totalXaf, discountXaf: offpeakXaf + (promo?.discountXaf ?? 0) + loyalty.discountXaf,
      promotionId: promo?.promotion.id ?? null, totalXaf: total, status: "pending", staffMemberId,
      offpeakPercent, offpeakDiscountXaf: offpeakXaf, loyaltyPointsUsed: loyalty.points, loyaltyDiscountXaf: loyalty.discountXaf,
      giftCardId: giftXaf > 0 ? card!.id : null, giftCardXaf: giftXaf, amountPaidXaf: giftXaf,
    }).$returningId();
    if (input.customerUserId) await recordSpend(tx, input.customerUserId, inserted.id, loyalty.points);
    await tx.insert(bookingItems).values(selection.services.map((service) => ({ bookingId: inserted.id, serviceId: service.id, serviceName: service.name, durationMinutes: service.durationMinutes, priceXaf: service.priceXaf })));
    await tx.insert(bookingEvents).values({ bookingId: inserted.id, actorUserId: input.customerUserId, fromStatus: null, toStatus: "pending", note: "Demande créée par le client" });
    await notifyProfessional(tx, professional.id, { type: "booking.created", title: "Nouvelle demande de rendez-vous", body: `${customerName} · ${selection.services.map((service) => service.name).join(" + ")} · ${formatDoualaSlot(starts)}`, link: "/professionnel" });
    return ref;
  });

  const view = await getBookingByReference(db, reference);
  if (!view) throw new BusinessError("BOOKING_NOT_FOUND");
  return view;
}

/**
 * Annulation par le client : une demande « en attente » à tout moment ; une réservation confirmée
 * jusqu’à N heures avant le rendez-vous (PAYMENT_FREE_CANCEL_HOURS, 24 h par défaut), avec
 * remboursement intégral si elle était payée. Plus tard, le client doit voir avec le professionnel.
 * Annuler deux fois renvoie simplement la réservation déjà annulée.
 */
export async function cancelBooking(db: Database, reference: string, customerUserId: number, now = new Date()): Promise<BookingView> {
  const refund = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.reference, reference)).limit(1).for("update");
    if (!booking || booking.customerUserId !== customerUserId) throw new BusinessError("BOOKING_NOT_FOUND");
    if (booking.status === "cancelled") return null;
    if (booking.status === "confirmed" && booking.startsAt.getTime() - now.getTime() < getPaymentSettings().freeCancelHours * 3_600_000) throw new BusinessError("CANCELLATION_TOO_LATE");
    if (booking.status !== "pending" && booking.status !== "confirmed") throw new BusinessError("BOOKING_NOT_CANCELLABLE");
    await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    await tx.insert(bookingEvents).values({ bookingId: booking.id, actorUserId: customerUserId, fromStatus: booking.status, toStatus: "cancelled", note: "Annulée par le client" });
    await notifyProfessional(tx, booking.professionalId, { type: "booking.cancelled_by_client", title: booking.status === "confirmed" ? "Rendez-vous annulé par le client" : "Demande annulée par le client", body: `${booking.customerName} · ${formatDoualaSlot(booking.startsAt)} · réf. ${booking.reference}`, link: "/professionnel" });
    return (await onBookingClosed(tx, booking)) ? booking.id : null;
  });
  if (refund) await startRefund(db, refund);
  const view = await getBookingByReference(db, reference);
  if (!view) throw new BusinessError("BOOKING_NOT_FOUND");
  return view;
}

/** Un rendez-vous se déplace aux mêmes conditions qu’une annulation gratuite. */
function reschedulable(row: typeof bookings.$inferSelect, now = Date.now()) {
  if (row.startsAt.getTime() <= now) return false;
  if (row.status === "pending") return true;
  return row.status === "confirmed" && row.startsAt.getTime() - now >= getPaymentSettings().freeCancelHours * 3_600_000;
}

/**
 * Déplacer un rendez-vous : nouveau créneau vérifié avec les mêmes règles qu’une réservation
 * (horaires, congés, agenda du collaborateur). Le professionnel doit de nouveau accepter ;
 * le paiement déjà effectué est conservé et le prix reste celui de la réservation d’origine.
 */
export async function rescheduleBooking(db: Database, input: { reference: string; customerUserId: number; startsAt: string; staffMemberId?: number | null }, now = new Date()): Promise<BookingView> {
  const starts = new Date(input.startsAt);
  if (!Number.isFinite(starts.getTime())) throw new BusinessError("INVALID_TIME_RANGE");
  if (starts.getTime() <= now.getTime()) throw new BusinessError("SLOT_IN_PAST");
  await db.transaction(async (tx) => {
    const [peek] = await tx.select({ professionalId: bookings.professionalId }).from(bookings).where(eq(bookings.reference, input.reference)).limit(1);
    if (!peek) throw new BusinessError("BOOKING_NOT_FOUND");
    // Même ordre de verrous que la création : professionnel, puis réservations.
    await tx.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.id, peek.professionalId)).limit(1).for("update");
    const [booking] = await tx.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1).for("update");
    if (!booking || booking.customerUserId !== input.customerUserId) throw new BusinessError("BOOKING_NOT_FOUND");
    if (booking.status !== "pending" && booking.status !== "confirmed") throw new BusinessError("BOOKING_NOT_CANCELLABLE");
    if (!reschedulable(booking, now.getTime())) throw new BusinessError("RESCHEDULE_TOO_LATE");
    const [professional] = await tx.select().from(professionalProfiles).where(eq(professionalProfiles.id, booking.professionalId)).limit(1);
    await extendHorizon(tx, professional.id, professional.weeklyHours, now);
    const ends = new Date(starts.getTime() + (booking.endsAt.getTime() - booking.startsAt.getTime()));
    await assertWithinAvailability(tx, professional.id, starts, ends);
    const requested = input.staffMemberId === undefined ? booking.staffMemberId : input.staffMemberId;
    const { candidates } = await staffCandidates(tx, professional.id, requested);
    const overlapping = (await tx.select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt, staffMemberId: bookings.staffMemberId }).from(bookings).where(and(eq(bookings.professionalId, professional.id), inArray(bookings.status, ACTIVE_STATUSES), lt(bookings.startsAt, ends), gt(bookings.endsAt, starts))).for("update"))
      .filter((item) => item.id !== booking.id);
    const free = freeStaffFor(candidates, overlapping, starts.getTime(), ends.getTime());
    if (!free.length) throw new BusinessError("SLOT_UNAVAILABLE");
    // Un paiement non encore fait est remis à zéro : il sera redemandé quand le professionnel acceptera le nouveau créneau.
    const resetPayment = booking.paymentStatus === "unpaid" ? { paymentStatus: "none" as const, amountDueXaf: 0 } : {};
    await tx.update(bookings).set({ startsAt: starts, endsAt: ends, staffMemberId: free[0], status: "pending", ...resetPayment }).where(eq(bookings.id, booking.id));
    await tx.insert(bookingEvents).values({ bookingId: booking.id, actorUserId: input.customerUserId, fromStatus: booking.status, toStatus: "pending", note: `Déplacé par le client : ${formatDoualaSlot(booking.startsAt)} → ${formatDoualaSlot(starts)}` });
    await notifyProfessional(tx, booking.professionalId, { type: "booking.rescheduled", title: "Rendez-vous déplacé par le client", body: `${booking.customerName} · ${formatDoualaSlot(booking.startsAt)} → ${formatDoualaSlot(starts)} · à accepter`, link: "/professionnel" });
  });
  const view = await getBookingByReference(db, input.reference);
  if (!view) throw new BusinessError("BOOKING_NOT_FOUND");
  return view;
}

/** Créneaux libres pour déplacer un rendez-vous (mêmes prestations ; le rendez-vous lui-même ne bloque pas). */
export async function rescheduleSlots(db: Database, input: { reference: string; customerUserId: number; day: string; staffMemberId?: number | null }) {
  const [booking] = await db.select().from(bookings).where(eq(bookings.reference, input.reference)).limit(1);
  if (!booking || booking.customerUserId !== input.customerUserId) throw new BusinessError("BOOKING_NOT_FOUND");
  const [pro] = await db.select({ slug: professionalProfiles.slug }).from(professionalProfiles).where(eq(professionalProfiles.id, booking.professionalId)).limit(1);
  const items = await db.select({ code: serviceCatalog.code }).from(bookingItems).innerJoin(serviceCatalog, eq(serviceCatalog.id, bookingItems.serviceId)).where(eq(bookingItems.bookingId, booking.id));
  const { getFreeSlots } = await import("./catalog");
  const staffMemberId = input.staffMemberId === undefined ? booking.staffMemberId : input.staffMemberId;
  return getFreeSlots(db, { slug: pro.slug, day: input.day, serviceIds: items.map((item) => item.code), staffMemberId, excludeBookingId: booking.id });
}

export async function buildViews(db: Database, rows: (typeof bookings.$inferSelect)[]): Promise<BookingView[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const staffIds = [...new Set(rows.map((row) => row.staffMemberId).filter((id): id is number => id !== null))];
  const staffRows = staffIds.length ? await db.select({ id: staffMembers.id, name: staffMembers.name }).from(staffMembers).where(inArray(staffMembers.id, staffIds)) : [];
  const promoIds = [...new Set(rows.map((row) => row.promotionId).filter((id): id is number => id !== null))];
  const [items, events, pros, promos, reviewRows] = await Promise.all([
    db.select({ bookingId: bookingItems.bookingId, name: bookingItems.serviceName, durationMinutes: bookingItems.durationMinutes, priceXaf: bookingItems.priceXaf, code: serviceCatalog.code })
      .from(bookingItems).leftJoin(serviceCatalog, eq(serviceCatalog.id, bookingItems.serviceId)).where(inArray(bookingItems.bookingId, ids)),
    db.select().from(bookingEvents).where(inArray(bookingEvents.bookingId, ids)).orderBy(bookingEvents.createdAt, bookingEvents.id),
    db.select().from(professionalProfiles).where(inArray(professionalProfiles.id, [...new Set(rows.map((row) => row.professionalId))])),
    promoIds.length ? db.select({ id: promotions.id, code: promotions.code }).from(promotions).where(inArray(promotions.id, promoIds)) : Promise.resolve([] as { id: number; code: string }[]),
    db.select({ bookingId: reviews.bookingId, rating: reviews.rating }).from(reviews).where(inArray(reviews.bookingId, ids)),
  ]);
  return rows.map((row) => {
    const pro = pros.find((item) => item.id === row.professionalId);
    const rowItems = items.filter((item) => item.bookingId === row.id);
    return {
      reference: row.reference,
      professional: { slug: pro?.slug ?? "", name: pro?.displayName ?? "", salon: pro?.salonName ?? pro?.displayName ?? "", city: pro?.city ?? "", neighborhood: pro?.neighborhood ?? "" },
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      timezone: row.timezone,
      mode: row.mode,
      address: row.address,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      notes: row.notes,
      subtotalXaf: row.subtotalXaf || row.totalXaf,
      discountXaf: row.discountXaf,
      promoCode: promos.find((promo) => promo.id === row.promotionId)?.code ?? null,
      totalXaf: row.totalXaf,
      paymentStatus: row.paymentStatus,
      amountDueXaf: row.amountDueXaf,
      amountPaidXaf: row.amountPaidXaf,
      durationMinutes: rowItems.reduce((sum, item) => sum + item.durationMinutes, 0),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      items: rowItems.map((item) => ({ serviceId: item.code ?? "", name: item.name, durationMinutes: item.durationMinutes, priceXaf: item.priceXaf })),
      review: reviewRows.find((review) => review.bookingId === row.id) ? { rating: reviewRows.find((review) => review.bookingId === row.id)!.rating } : null,
      canReview: !reviewRows.some((review) => review.bookingId === row.id) && isReviewable(row),
      staff: staffRows.find((member) => member.id === row.staffMemberId) ?? null,
      offpeakPercent: row.offpeakPercent,
      offpeakDiscountXaf: row.offpeakDiscountXaf,
      loyaltyPointsUsed: row.loyaltyPointsUsed,
      loyaltyDiscountXaf: row.loyaltyDiscountXaf,
      giftCardXaf: row.giftCardXaf,
      canReschedule: reschedulable(row),
      events: events.filter((event) => event.bookingId === row.id).map((event) => ({ fromStatus: event.fromStatus, toStatus: event.toStatus, note: event.note, createdAt: event.createdAt.toISOString() })),
    };
  });
}

export async function getBookingByReference(db: Database, reference: string): Promise<BookingView | null> {
  const rows = await db.select().from(bookings).where(eq(bookings.reference, reference)).limit(1);
  return (await buildViews(db, rows))[0] ?? null;
}

export async function getBookingsForUser(db: Database, customerUserId: number): Promise<BookingView[]> {
  const rows = await db.select().from(bookings).where(eq(bookings.customerUserId, customerUserId)).orderBy(desc(bookings.startsAt)).limit(200);
  return buildViews(db, rows);
}
