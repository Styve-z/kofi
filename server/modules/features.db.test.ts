/** Fonctionnalités « type Treatwell » contre une vraie base : favoris, équipe, heures creuses, fidélité, cartes cadeaux, déplacement. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { giftCards, professionalProfiles, users, type User } from "../../drizzle/schema";
import type { Database } from "../db";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { cancelBooking, createBooking, getBookingsForUser, rescheduleBooking, type CreateBookingInput } from "./booking";
import { getFreeSlots, searchCatalog } from "./catalog";
import { listFavorites, toggleFavorite } from "./favorites";
import { checkGiftCard, listMyGiftCards, purchaseGiftCard } from "./giftcards";
import { getMyLoyalty } from "./loyalty";
import { addOffpeakRule } from "./offpeak";
import { setPaymentProviderForTests } from "./payments/config";
import { simulateGiftCardTestPayment } from "./payments/index";
import { testProvider } from "./payments/provider";
import { transitionMyBooking } from "./pro";
import { saveStaffMember } from "./staff";
import { doualaDateTime } from "./time";

describe.skipIf(!url)("fonctionnalités clients et pros (base réelle)", () => {
  let db: Database;
  let client: User; let other: User; let pro: User;
  const AFTER = doualaDateTime(MONDAY, "12:00");
  beforeAll(async () => { process.env.DATABASE_URL = url; db = await openTestDb(); }, 60_000);
  afterAll(async () => { setPaymentProviderForTests(undefined); await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    setPaymentProviderForTests(null);
    await db.insert(users).values([{ openId: "c1", name: "Amina", role: "user" }, { openId: "c2", name: "Brice", role: "user" }, { openId: "p1", name: "Cédric", role: "user" }]);
    const all = await db.select().from(users);
    [client, other, pro] = ["c1", "c2", "p1"].map((openId) => all.find((user) => user.openId === openId)!);
    await db.update(professionalProfiles).set({ ownerUserId: pro.id }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
  });
  const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({ customerUserId: client.id, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 75, timezone: "Africa/Douala", mode: "salon", customerName: "Amina Njoya", customerPhone: "690000001", serviceIds: ["cedric-duo"], totalXaf: 10_000, ...overrides });
  const mine = async (reference: string, userId = client.id) => (await getBookingsForUser(db, userId)).find((item) => item.reference === reference)!;

  it("favoris : ajout, retrait, liste", async () => {
    expect(await toggleFavorite(db, client.id, "cedric-mbarga")).toEqual({ favorite: true });
    expect((await listFavorites(db, client.id)).map((pro) => pro.slug)).toEqual(["cedric-mbarga"]);
    expect(await listFavorites(db, other.id)).toEqual([]);
    expect(await toggleFavorite(db, client.id, "cedric-mbarga")).toEqual({ favorite: false });
    await expect(toggleFavorite(db, client.id, "inconnu")).rejects.toThrow("PROFESSIONAL_NOT_FOUND");
  });

  it("recherche : tri par prix, disponibilité un jour donné, offres seulement", async () => {
    const byPrice = await searchCatalog(db, { sort: "price_asc" }, NOW);
    expect(byPrice.map((pro) => pro.priceFrom)).toEqual([...byPrice.map((pro) => pro.priceFrom)].sort((a, b) => a - b));
    expect((await searchCatalog(db, { availableOn: MONDAY }, NOW)).length).toBeGreaterThan(0);
    expect(await searchCatalog(db, { availableOn: "2030-07-01" }, NOW)).toEqual([]); // hors des 14 jours ouverts du jeu de test
    expect(await searchCatalog(db, { offersOnly: true }, NOW)).toEqual([]);
    await addOffpeakRule(db, pro.id, { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", percent: 20 });
    expect((await searchCatalog(db, { offersOnly: true }, NOW)).map((item) => item.slug)).toEqual(["cedric-mbarga"]);
  });

  it("heures creuses : remise affichée sur les créneaux et recalculée par le serveur", async () => {
    await addOffpeakRule(db, pro.id, { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", percent: 20 });
    await expect(addOffpeakRule(db, pro.id, { dayOfWeek: 1, startTime: "12:00", endTime: "11:00", percent: 20 })).rejects.toThrow("OFFPEAK_INVALID");
    const slots = await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-duo"], now: NOW });
    expect(slots.discounts[at(MONDAY, "10:00")]).toBe(20);
    expect(slots.discounts[at(MONDAY, "14:00")]).toBeUndefined();
    const created = await createBooking(db, booking(), NOW);
    expect(created).toMatchObject({ subtotalXaf: 10_000, offpeakPercent: 20, offpeakDiscountXaf: 2_000, totalXaf: 8_000 });
    const full = await createBooking(db, booking({ startsAt: at(MONDAY, "14:00") }), NOW);
    expect(full).toMatchObject({ offpeakDiscountXaf: 0, totalXaf: 10_000 });
  });

  it("équipe : rendez-vous en parallèle avec des collaborateurs différents, jamais deux fois la même personne", async () => {
    const a = await saveStaffMember(db, pro.id, { name: "Paul", title: "Barbier" });
    const b = await saveStaffMember(db, pro.id, { name: "Joseph" });
    const first = await createBooking(db, booking({ staffMemberId: a.id }), NOW);
    expect(first.staff).toEqual({ id: a.id, name: "Paul" });
    await expect(createBooking(db, booking({ customerUserId: other.id, staffMemberId: a.id }), NOW)).rejects.toThrow("SLOT_UNAVAILABLE");
    const any = await createBooking(db, booking({ customerUserId: other.id }), NOW); // « peu importe » : Joseph est libre
    expect(any.staff?.id).toBe(b.id);
    const slots = await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-duo"], now: NOW });
    expect(slots.startsAt).not.toContain(at(MONDAY, "10:00"));
    await expect(createBooking(db, booking({ staffMemberId: 999_999 }), NOW)).rejects.toThrow("STAFF_NOT_FOUND");
  });

  it("fidélité : gagnés à la fin du rendez-vous, utilisés puis rendus si la réservation est annulée", async () => {
    const created = await createBooking(db, booking(), NOW);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "completed" }, AFTER);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "completed" }, AFTER).catch(() => null); // un second appel ne recrédite pas
    expect((await getMyLoyalty(db, client.id)).balance).toBe(100);
    await expect(createBooking(db, booking({ startsAt: at(MONDAY, "14:00"), loyaltyPoints: 200 }), NOW)).rejects.toThrow("LOYALTY_INVALID");
    await expect(createBooking(db, booking({ startsAt: at(MONDAY, "14:00"), loyaltyPoints: 50 }), NOW)).rejects.toThrow("LOYALTY_INVALID");
    const used = await createBooking(db, booking({ startsAt: at(MONDAY, "14:00"), loyaltyPoints: 100 }), NOW);
    expect(used).toMatchObject({ loyaltyPointsUsed: 100, loyaltyDiscountXaf: 500, totalXaf: 9_500 });
    expect((await getMyLoyalty(db, client.id)).balance).toBe(0);
    await cancelBooking(db, used.reference, client.id, NOW);
    expect((await getMyLoyalty(db, client.id)).balance).toBe(100);
  });

  it("carte cadeau : code secret avant paiement, utilisable ensuite, recréditée à l’annulation", async () => {
    await expect(purchaseGiftCard(db, other.id, { amountXaf: 10_000, operator: "mtn", phone: "690000002" })).rejects.toThrow("PAYMENTS_DISABLED");
    setPaymentProviderForTests(testProvider());
    await expect(purchaseGiftCard(db, other.id, { amountXaf: 1_000, operator: "mtn", phone: "690000002" })).rejects.toThrow("GIFT_CARD_INVALID");
    const bought = await purchaseGiftCard(db, other.id, { amountXaf: 15_000, recipientName: "Amina", operator: "mtn", phone: "690000002" });
    expect((await listMyGiftCards(db, other.id))[0]).toMatchObject({ code: null, status: "pending_payment" });
    await expect(simulateGiftCardTestPayment(db, client.id, { paymentId: bought.paymentId, outcome: "succeeded" })).rejects.toThrow("PAYMENT_NOT_FOUND");
    await simulateGiftCardTestPayment(db, other.id, { paymentId: bought.paymentId, outcome: "succeeded" });
    // Les tests se déroulent « en 2030 » : la carte (valable 1 an à partir d’aujourd’hui) est prolongée pour l’occasion.
    await db.update(giftCards).set({ expiresAt: doualaDateTime("2031-01-01", "00:00") });
    expect(await checkGiftCard(db, (await listMyGiftCards(db, other.id))[0].code!, doualaDateTime("2032-01-01", "00:00"))).toEqual({ valid: false });
    const [card] = await listMyGiftCards(db, other.id);
    expect(card).toMatchObject({ status: "active", balanceXaf: 15_000 });
    expect(await checkGiftCard(db, card.code!, NOW)).toMatchObject({ valid: true, balanceXaf: 15_000 });

    const paid = await createBooking(db, booking({ giftCardCode: card.code!.toLowerCase() }), NOW);
    expect(paid).toMatchObject({ totalXaf: 10_000, giftCardXaf: 10_000, amountPaidXaf: 10_000 });
    expect(await checkGiftCard(db, card.code!, NOW)).toMatchObject({ balanceXaf: 5_000 });
    await transitionMyBooking(db, pro.id, { reference: paid.reference, to: "confirmed" }, NOW);
    expect(await mine(paid.reference)).toMatchObject({ paymentStatus: "paid" });
    await cancelBooking(db, paid.reference, client.id, NOW);
    expect(await mine(paid.reference)).toMatchObject({ status: "cancelled", amountPaidXaf: 0, giftCardXaf: 0 });
    expect(await checkGiftCard(db, card.code!, NOW)).toMatchObject({ balanceXaf: 15_000 });
    await expect(createBooking(db, booking({ giftCardCode: "KDO-FAUX-CODE" }), NOW)).rejects.toThrow("GIFT_CARD_INVALID");
  });

  it("déplacer : nouveau créneau vérifié, à ré-accepter par le pro, paiement conservé", async () => {
    const created = await createBooking(db, booking(), NOW);
    await createBooking(db, booking({ customerUserId: other.id, startsAt: at(MONDAY, "14:00") }), NOW);
    await expect(rescheduleBooking(db, { reference: created.reference, customerUserId: other.id, startsAt: at(MONDAY, "16:00") }, NOW)).rejects.toThrow("BOOKING_NOT_FOUND");
    await expect(rescheduleBooking(db, { reference: created.reference, customerUserId: client.id, startsAt: at(MONDAY, "14:00") }, NOW)).rejects.toThrow("SLOT_UNAVAILABLE");
    await expect(rescheduleBooking(db, { reference: created.reference, customerUserId: client.id, startsAt: at(MONDAY, "03:00") }, NOW)).rejects.toThrow("SLOT_OUTSIDE_HOURS");
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    const moved = await rescheduleBooking(db, { reference: created.reference, customerUserId: client.id, startsAt: at(MONDAY, "16:00") }, NOW);
    expect(moved).toMatchObject({ status: "pending", startsAt: at(MONDAY, "16:00"), totalXaf: 10_000 });
    expect(moved.events.at(-1)?.note).toContain("Déplacé par le client");
    // L’ancien créneau est libéré.
    const slots = await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-duo"], now: NOW });
    expect(slots.startsAt).toContain(at(MONDAY, "10:00"));
    // Trop tard pour un rendez-vous confirmé (moins de 24 h avant).
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    await expect(rescheduleBooking(db, { reference: created.reference, customerUserId: client.id, startsAt: at(MONDAY, "17:00") }, doualaDateTime(MONDAY, "08:00"))).rejects.toThrow("RESCHEDULE_TOO_LATE");
  });
});
