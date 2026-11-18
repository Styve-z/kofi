/**
 * Tests d’intégration contre une vraie base MySQL/MariaDB.
 * Lancés seulement si TEST_DATABASE_URL est défini (base dédiée, VIDÉE à chaque exécution).
 *   TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/kofi_test pnpm test
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { availabilitySlots, bookings, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { at, MONDAY, NOW, openTestDb, resetTestDb, SUNDAY, TEST_DATABASE_URL as url, TUESDAY } from "../test/dbSetup";
import { cancelBooking, createBooking, getBookingsForUser, normalizeCameroonPhone, type CreateBookingInput } from "./booking";
import { getFreeSlots, getProfessional, searchCatalog } from "./catalog";
import { doualaDateTime } from "./time";

const base = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
  customerUserId: 1, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 50, timezone: "Africa/Douala",
  mode: "salon", customerName: "Client Test", customerPhone: "6 90 00 00 01", serviceIds: ["cedric-fade"], totalXaf: 7000, ...overrides,
});

describe("normalizeCameroonPhone", () => {
  it("accepte les formats courants et refuse le reste", () => {
    expect(normalizeCameroonPhone("690 12 34 56")).toBe("+237690123456");
    expect(normalizeCameroonPhone("+237 6 90 12 34 56")).toBe("+237690123456");
    expect(normalizeCameroonPhone("00237690123456")).toBe("+237690123456");
    expect(normalizeCameroonPhone("233 42 10 10")).toBe("+237233421010");
    expect(normalizeCameroonPhone("12345678")).toBeNull();
    expect(normalizeCameroonPhone("790123456")).toBeNull();
  });
});

describe.skipIf(!url)("réservations persistées (base réelle)", () => {
  let db: Database;

  beforeAll(async () => { db = await openTestDb(); }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => { await resetTestDb(db); });

  describe("catalogue", () => {
    it("lit les professionnels et prestations depuis la base, avec filtres", async () => {
      expect((await searchCatalog(db)).map((pro) => pro.slug).sort()).toEqual(["cedric-mbarga", "joelle-ndongo", "mireille-nkoulou", "sandra-essomba"]);
      expect((await searchCatalog(db, { city: "Douala" })).length).toBe(2);
      expect((await searchCatalog(db, { mode: "domicile" })).map((pro) => pro.slug).sort()).toEqual(["joelle-ndongo", "mireille-nkoulou"]);
      expect((await searchCatalog(db, { query: "barbe" })).map((pro) => pro.slug)).toEqual(["cedric-mbarga"]);
      expect((await searchCatalog(db, { maxPrice: 5000 })).map((pro) => pro.slug)).toEqual(["cedric-mbarga"]);
      const mireille = await getProfessional(db, "mireille-nkoulou");
      expect(mireille?.services.map((service) => service.id)).toContain("mireille-twist");
      expect(mireille?.specialties).toContain("Tresses");
    });

    it("cache un professionnel suspendu et refuse de le réserver", async () => {
      await db.update(professionalProfiles).set({ verificationStatus: "suspended" }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
      expect((await searchCatalog(db)).some((pro) => pro.slug === "cedric-mbarga")).toBe(false);
      expect(await getProfessional(db, "cedric-mbarga")).toBeNull();
      await expect(createBooking(db, base(), NOW)).rejects.toThrow("PROFESSIONAL_NOT_FOUND");
    });
  });

  describe("création", () => {
    it("enregistre la réservation, ses prestations et son historique", async () => {
      const booking = await createBooking(db, base({ serviceIds: ["cedric-fade", "cedric-barbe"], durationMinutes: 80, totalXaf: 11000, notes: "Première visite" }), NOW);
      expect(booking.reference).toMatch(/^KOFI-\d{4}-[A-Z0-9]{8}$/);
      expect(booking.status).toBe("pending");
      expect(booking.customerPhone).toBe("+237690000001");
      expect(booking.startsAt).toBe(at(MONDAY, "10:00"));
      expect(booking.endsAt).toBe(at(MONDAY, "11:20"));
      expect(booking.items.map((item) => item.serviceId)).toEqual(["cedric-fade", "cedric-barbe"]);
      expect(booking.events).toHaveLength(1);
      const mine = await getBookingsForUser(db, 1);
      expect(mine.map((item) => item.reference)).toEqual([booking.reference]);
      expect(await getBookingsForUser(db, 2)).toEqual([]);
    });

    it("refuse un créneau qui chevauche une réservation existante", async () => {
      await createBooking(db, base(), NOW);
      await expect(createBooking(db, base({ customerUserId: 2, startsAt: at(MONDAY, "10:30") }), NOW)).rejects.toThrow("SLOT_UNAVAILABLE");
      await expect(createBooking(db, base({ customerUserId: 2, startsAt: at(MONDAY, "10:50") }), NOW)).resolves.toMatchObject({ status: "pending" });
    });

    it("ne crée qu’une seule réservation quand plusieurs clients visent le même créneau en même temps", async () => {
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => createBooking(db, base({ customerUserId: 100 + index, startsAt: at(MONDAY, "15:00") }), NOW)));
      const ok = attempts.filter((attempt) => attempt.status === "fulfilled");
      const refused = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(refused.every((attempt) => attempt.reason.message === "SLOT_UNAVAILABLE")).toBe(true);
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(bookings);
      expect(Number(count)).toBe(1);
    }, 30_000);

    it("recalcule durée et total côté serveur", async () => {
      await expect(createBooking(db, base({ durationMinutes: 1 }), NOW)).rejects.toThrow("DURATION_MISMATCH");
      await expect(createBooking(db, base({ totalXaf: 1 }), NOW)).rejects.toThrow("TOTAL_MISMATCH");
      await expect(createBooking(db, base({ serviceIds: ["mireille-twist"], durationMinutes: 150, totalXaf: 18000 }), NOW)).rejects.toThrow("SERVICE_NOT_FOUND");
      await expect(createBooking(db, base({ serviceIds: ["cedric-fade", "cedric-fade"], durationMinutes: 100, totalXaf: 14000 }), NOW)).rejects.toThrow("SERVICE_NOT_FOUND");
    });

    it("refuse un mode incompatible", async () => {
      await expect(createBooking(db, base({ mode: "domicile" }), NOW)).rejects.toThrow("MODE_UNAVAILABLE");
      await expect(createBooking(db, base({ professionalSlug: "joelle-ndongo", serviceIds: ["joelle-enfant"], durationMinutes: 60, totalXaf: 6000, mode: "salon" }), NOW)).rejects.toThrow("MODE_UNAVAILABLE");
    });

    it("exige une adresse pour un rendez-vous à domicile", async () => {
      const home = { professionalSlug: "joelle-ndongo", serviceIds: ["joelle-enfant"], durationMinutes: 60, totalXaf: 6000, mode: "domicile" as const };
      await expect(createBooking(db, base(home), NOW)).rejects.toThrow("ADDRESS_REQUIRED");
      await expect(createBooking(db, base({ ...home, address: "Rue" }), NOW)).rejects.toThrow("ADDRESS_REQUIRED");
      await expect(createBooking(db, base({ ...home, address: "Quartier Tamdja, près de la pharmacie" }), NOW)).resolves.toMatchObject({ address: "Quartier Tamdja, près de la pharmacie" });
      await expect(createBooking(db, base({ address: "Adresse inutile au salon" }), NOW)).resolves.toMatchObject({ address: null });
    });

    it("refuse les créneaux passés, hors horaires, le dimanche et pendant un congé", async () => {
      await expect(createBooking(db, base(), doualaDateTime(MONDAY, "11:00"))).rejects.toThrow("SLOT_IN_PAST");
      await expect(createBooking(db, base({ startsAt: at(MONDAY, "07:00") }), NOW)).rejects.toThrow("SLOT_OUTSIDE_HOURS");
      await expect(createBooking(db, base({ startsAt: at(MONDAY, "19:30") }), NOW)).rejects.toThrow("SLOT_OUTSIDE_HOURS");
      await expect(createBooking(db, base({ startsAt: at(SUNDAY, "10:00") }), NOW)).rejects.toThrow("SLOT_OUTSIDE_HOURS");
      const [cedric] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.slug, "cedric-mbarga"));
      await db.insert(availabilitySlots).values({ professionalId: cedric.id, startsAt: doualaDateTime(MONDAY, "12:00"), endsAt: doualaDateTime(MONDAY, "14:00"), status: "leave", note: "Pause" });
      await expect(createBooking(db, base({ startsAt: at(MONDAY, "13:30") }), NOW)).rejects.toThrow("SLOT_OUTSIDE_HOURS");
    });

    it("refuse un nom ou un téléphone invalide", async () => {
      await expect(createBooking(db, base({ customerPhone: "12345678" }), NOW)).rejects.toThrow("CUSTOMER_DETAILS_INVALID");
      await expect(createBooking(db, base({ customerName: " A " }), NOW)).rejects.toThrow("CUSTOMER_DETAILS_INVALID");
    });

    it("compte le temps de préparation dans l’occupation du professionnel", async () => {
      const color = { professionalSlug: "sandra-essomba", serviceIds: ["sandra-color"], durationMinutes: 135, totalXaf: 25000 };
      const first = await createBooking(db, base({ ...color, startsAt: at(TUESDAY, "09:00") }), NOW);
      expect(first.endsAt).toBe(at(TUESDAY, "11:30"));
      await expect(createBooking(db, base({ professionalSlug: "sandra-essomba", serviceIds: ["sandra-brush"], durationMinutes: 60, totalXaf: 9000, customerUserId: 2, startsAt: at(TUESDAY, "11:20") }), NOW)).rejects.toThrow("SLOT_UNAVAILABLE");
    });
  });

  describe("annulation", () => {
    it("n’est possible que par le client propriétaire, et une seule fois", async () => {
      const booking = await createBooking(db, base(), NOW);
      await expect(cancelBooking(db, booking.reference, 999)).rejects.toThrow("BOOKING_NOT_FOUND");
      const cancelled = await cancelBooking(db, booking.reference, 1);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.events.map((event) => event.toStatus)).toEqual(["pending", "cancelled"]);
      const again = await cancelBooking(db, booking.reference, 1);
      expect(again.events).toHaveLength(2);
      await expect(createBooking(db, base({ customerUserId: 2 }), NOW)).resolves.toMatchObject({ status: "pending" });
    });

    it("une réservation confirmée s’annule jusqu’à 24 h avant, plus tard elle est protégée", async () => {
      const booking = await createBooking(db, base(), NOW);
      await db.update(bookings).set({ status: "confirmed" }).where(eq(bookings.reference, booking.reference));
      await expect(cancelBooking(db, booking.reference, 1, doualaDateTime("2030-05-05", "11:00"))).rejects.toThrow("CANCELLATION_TOO_LATE");
      await expect(cancelBooking(db, booking.reference, 1, doualaDateTime("2030-05-05", "09:00"))).resolves.toMatchObject({ status: "cancelled" });
    });
  });

  describe("créneaux libres", () => {
    it("propose les départs qui tiennent dans les horaires et évitent les réservations", async () => {
      const before = await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-fade"], now: NOW });
      expect(before.durationMinutes).toBe(50);
      expect(before.startsAt[0]).toBe(at(MONDAY, "09:00"));
      expect(before.startsAt.at(-1)).toBe(at(MONDAY, "19:00"));
      await createBooking(db, base(), NOW);
      const after = await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-fade"], now: NOW });
      expect(after.startsAt).not.toContain(at(MONDAY, "09:30"));
      expect(after.startsAt).not.toContain(at(MONDAY, "10:00"));
      expect(after.startsAt).toContain(at(MONDAY, "09:00"));
      expect(after.startsAt).toContain(at(MONDAY, "11:00"));
      expect((await getFreeSlots(db, { slug: "cedric-mbarga", day: SUNDAY, serviceIds: ["cedric-fade"], now: NOW })).startsAt).toEqual([]);
      const later = await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-fade"], now: doualaDateTime(MONDAY, "18:00") });
      expect(later.startsAt).toEqual([at(MONDAY, "18:30"), at(MONDAY, "19:00")]);
    });
  });
});
