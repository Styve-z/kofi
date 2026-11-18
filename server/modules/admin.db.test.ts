/** Tests du back-office contre une vraie base (TEST_DATABASE_URL), droits d’accès compris. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url, TUESDAY } from "../test/dbSetup";
import { getOverview, listAudit, listBookings, listProfessionals, listUsers, setProfessionalStatus, setUserStatus, transitionBooking } from "./admin";
import { createBooking, type CreateBookingInput } from "./booking";
import { searchCatalog } from "./catalog";
import { doualaDateTime } from "./time";

const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
  customerUserId: null, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 50, timezone: "Africa/Douala",
  mode: "salon", customerName: "Client Test", customerPhone: "690000001", serviceIds: ["cedric-fade"], totalXaf: 7000, ...overrides,
});

describe.skipIf(!url)("back-office administrateur (base réelle)", () => {
  let db: Database;
  let admin: User;
  let client: User;

  beforeAll(async () => { db = await openTestDb(); }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    await db.insert(users).values([{ openId: "admin-1", name: "Admin Test", role: "admin" }, { openId: "client-1", name: "Esther Client", role: "user" }]);
    [admin] = await db.select().from(users).where(eq(users.openId, "admin-1"));
    [client] = await db.select().from(users).where(eq(users.openId, "client-1"));
  });

  const auditCount = async () => (await db.select().from(auditLogs)).length;

  it("calcule la vue d’ensemble sur 7 jours en heure de Douala", async () => {
    const a = await createBooking(db, booking({ customerUserId: client.id }), NOW);
    const b = await createBooking(db, booking({ startsAt: at(MONDAY, "14:00") }), NOW);
    await createBooking(db, booking({ startsAt: at(MONDAY, "16:00") }), NOW);
    await createBooking(db, booking({ professionalSlug: "mireille-nkoulou", serviceIds: ["mireille-coupe"], durationMinutes: 60, totalXaf: 8000, startsAt: at(MONDAY, "09:00") }), NOW);
    await transitionBooking(db, admin.id, { reference: a.reference, to: "confirmed" });
    await transitionBooking(db, admin.id, { reference: a.reference, to: "completed" });
    await transitionBooking(db, admin.id, { reference: b.reference, to: "cancelled", note: "Client injoignable" });

    const overview = await getOverview(db, doualaDateTime(MONDAY, "20:00"));
    expect(overview.bookingsToday).toBe(4);
    expect(overview.bookingsTodayPending).toBe(2);
    expect(overview.confirmationRate).toBe(50);
    expect(overview.bookedVolumeXaf).toBe(7000);
    expect(overview.cancellations).toBe(1);
    expect(overview.perDay.map((day) => day.count)).toEqual([0, 0, 0, 0, 0, 0, 4]);
    expect(overview.perDay.at(-1)?.day).toBe(MONDAY);
    expect(overview.topProfessionals[0]).toMatchObject({ slug: "cedric-mbarga", count: 2 });
    expect(overview.professionalsPending).toBe(1);
    expect(overview.usersActive).toBe(2);
    // Le lendemain, les rendez-vous de lundi restent dans la semaine mais plus dans « aujourd’hui ».
    const nextDay = await getOverview(db, doualaDateTime(TUESDAY, "08:00"));
    expect(nextDay.bookingsToday).toBe(0);
    expect(nextDay.perDay.at(-2)?.count).toBe(4);
  });

  describe("professionnels", () => {
    it("valide, refuse avec motif, suspend et réactive, en journalisant chaque action", async () => {
      expect((await listProfessionals(db)).counts).toMatchObject({ pending: 1, verified: 3 });
      await setProfessionalStatus(db, admin.id, { slug: "sandra-essomba", action: "validate" });
      expect((await listProfessionals(db, { status: "verified" })).items.map((pro) => pro.slug)).toContain("sandra-essomba");

      await expect(setProfessionalStatus(db, admin.id, { slug: "cedric-mbarga", action: "suspend" })).rejects.toThrow("REASON_REQUIRED");
      await setProfessionalStatus(db, admin.id, { slug: "cedric-mbarga", action: "suspend", reason: "Trois rendez-vous non honorés" });
      expect((await searchCatalog(db)).some((pro) => pro.slug === "cedric-mbarga")).toBe(false);
      await expect(createBooking(db, booking(), NOW)).rejects.toThrow("PROFESSIONAL_NOT_FOUND");
      const suspended = (await listProfessionals(db, { status: "suspended" })).items[0];
      expect(suspended).toMatchObject({ slug: "cedric-mbarga", note: "Trois rendez-vous non honorés" });

      await expect(setProfessionalStatus(db, admin.id, { slug: "joelle-ndongo", action: "reactivate" })).rejects.toThrow("INVALID_TRANSITION");
      await setProfessionalStatus(db, admin.id, { slug: "cedric-mbarga", action: "reactivate" });
      expect((await searchCatalog(db)).some((pro) => pro.slug === "cedric-mbarga")).toBe(true);

      const log = await listAudit(db);
      expect(log.map((entry) => entry.action)).toEqual(["Professionnel réactivé", "Professionnel suspendu", "Professionnel validé"]);
      expect(log[1]).toMatchObject({ actor: "Admin Test", target: "Cédric Mbarga", detail: "Trois rendez-vous non honorés" });
    });

    it("un profil refusé disparaît de la recherche et peut être validé plus tard", async () => {
      await expect(setProfessionalStatus(db, admin.id, { slug: "sandra-essomba", action: "refuse", reason: " " })).rejects.toThrow("REASON_REQUIRED");
      await setProfessionalStatus(db, admin.id, { slug: "sandra-essomba", action: "refuse", reason: "Pièces incomplètes" });
      expect((await searchCatalog(db)).some((pro) => pro.slug === "sandra-essomba")).toBe(false);
      await setProfessionalStatus(db, admin.id, { slug: "sandra-essomba", action: "validate" });
      expect((await searchCatalog(db)).find((pro) => pro.slug === "sandra-essomba")?.verified).toBe(true);
    });
  });

  describe("réservations", () => {
    it("n’autorise que les transitions prévues et garde l’historique", async () => {
      const created = await createBooking(db, booking({ customerUserId: client.id }), NOW);
      expect(created.status).toBe("pending");
      const confirmed = await transitionBooking(db, admin.id, { reference: created.reference, to: "confirmed" });
      expect(confirmed.allowedTransitions).toEqual(["completed", "no_show", "cancelled"]);
      await expect(transitionBooking(db, admin.id, { reference: created.reference, to: "pending" })).rejects.toThrow("INVALID_TRANSITION");
      await expect(transitionBooking(db, admin.id, { reference: created.reference, to: "cancelled" })).rejects.toThrow("REASON_REQUIRED");
      const done = await transitionBooking(db, admin.id, { reference: created.reference, to: "no_show" });
      expect(done.allowedTransitions).toEqual([]);
      expect(done.events.map((event) => event.toStatus)).toEqual(["pending", "confirmed", "no_show"]);
      await expect(transitionBooking(db, admin.id, { reference: created.reference, to: "cancelled", note: "Erreur" })).rejects.toThrow("INVALID_TRANSITION");
      await expect(transitionBooking(db, admin.id, { reference: "KOFI-INCONNU", to: "confirmed" })).rejects.toThrow("BOOKING_NOT_FOUND");
      expect(await auditCount()).toBe(2);
    });

    it("filtre par statut et recherche par référence, client, téléphone ou professionnel", async () => {
      const a = await createBooking(db, booking({ customerName: "Esther Ngo Bassa", customerPhone: "6 77 45 10 02" }), NOW);
      await createBooking(db, booking({ professionalSlug: "mireille-nkoulou", serviceIds: ["mireille-coupe"], durationMinutes: 60, totalXaf: 8000, customerName: "Paul Etoundi" }), NOW);
      await transitionBooking(db, admin.id, { reference: a.reference, to: "confirmed" });
      expect((await listBookings(db)).counts).toMatchObject({ pending: 1, confirmed: 1 });
      expect((await listBookings(db, { status: "pending" })).items.map((item) => item.customerName)).toEqual(["Paul Etoundi"]);
      expect((await listBookings(db, { query: a.reference })).items).toHaveLength(1);
      expect((await listBookings(db, { query: "esther" })).items.map((item) => item.reference)).toEqual([a.reference]);
      expect((await listBookings(db, { query: "77 45 10" })).items.map((item) => item.reference)).toEqual([a.reference]);
      expect((await listBookings(db, { query: "Mireille" })).items.map((item) => item.customerName)).toEqual(["Paul Etoundi"]);
      expect((await listBookings(db, { query: "100%_" })).items).toEqual([]);
    });
  });

  describe("utilisateurs", () => {
    it("suspend avec motif, interdit l’auto-suspension et retrouve un client par téléphone", async () => {
      await createBooking(db, booking({ customerUserId: client.id, customerPhone: "699112233" }), NOW);
      await expect(setUserStatus(db, admin.id, { userId: admin.id, status: "suspended", reason: "test" })).rejects.toThrow("CANNOT_SUSPEND_SELF");
      await expect(setUserStatus(db, admin.id, { userId: client.id, status: "suspended" })).rejects.toThrow("REASON_REQUIRED");
      await setUserStatus(db, admin.id, { userId: client.id, status: "suspended", reason: "Fraude signalée" });
      const found = await listUsers(db, { query: "99 11 22" });
      expect(found.map((user) => [user.name, user.status, user.bookingsCount, user.lastPhone])).toEqual([["Esther Client", "suspended", 1, "+237699112233"]]);
      await setUserStatus(db, admin.id, { userId: client.id, status: "active" });
      expect((await listAudit(db)).map((entry) => entry.action)).toEqual(["Compte réactivé", "Compte suspendu"]);
    });
  });

  describe("droits d’accès via l’API", () => {
    const caller = (user: User | null) => appRouter.createCaller({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
    beforeAll(() => { process.env.DATABASE_URL = url; });

    it("réserve le back-office aux administrateurs actifs", async () => {
      await expect(caller(null).admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(client).admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(client).admin.professionals.setStatus({ slug: "cedric-mbarga", action: "suspend", reason: "tentative" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(admin).admin.overview()).resolves.toMatchObject({ professionalsPending: 1 });
      await expect(caller({ ...admin, status: "suspended" }).admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("bloque un compte suspendu sur les procédures connectées", async () => {
      await expect(caller({ ...client, status: "suspended" }).booking.mine()).rejects.toMatchObject({ code: "FORBIDDEN", message: "ACCOUNT_SUSPENDED" });
      await expect(caller(client).booking.mine()).resolves.toEqual([]);
    });

    it("renvoie des erreurs métier typées", async () => {
      await expect(caller(admin).admin.bookings.transition({ reference: "KOFI-X", to: "confirmed" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "BOOKING_NOT_FOUND" });
      await expect(caller(admin).admin.professionals.setStatus({ slug: "joelle-ndongo", action: "validate" })).rejects.toMatchObject({ code: "CONFLICT", message: "INVALID_TRANSITION" });
    });
  });
});
