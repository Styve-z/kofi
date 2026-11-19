/** Tests de l’espace professionnel contre une vraie base (TEST_DATABASE_URL). */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { professionalProfiles, users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { at, MONDAY, NOW, openTestDb, resetTestDb, SUNDAY, TEST_DATABASE_URL as url, TUESDAY } from "../test/dbSetup";
import { setProfessionalStatus } from "./admin";
import { createBooking, getBookingsForUser, type CreateBookingInput } from "./booking";
import { getFreeSlots, getProfessional, listNeighborhoods, searchCatalog } from "./catalog";
import { addClosure, applyAsProfessional, getMyOverview, getMyProfessional, listClosures, listMyBookings, removeClosure, saveService, setServiceActive, setWeeklyHours, slugify, transitionMyBooking, updateMyProfile } from "./pro";
import { doualaDateTime } from "./time";

describe("slugify", () => {
  it("produit une adresse lisible", () => {
    expect(slugify("Joëlle à Domicile !")).toBe("joelle-a-domicile");
    expect(slugify("***")).toBe("pro");
  });
});

describe.skipIf(!url)("espace professionnel (base réelle)", () => {
  let db: Database;
  let pro: User;
  let other: User;
  let client: User;
  let admin: User;

  beforeAll(async () => { db = await openTestDb(); }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    await db.insert(users).values([
      { openId: "pro-cedric", name: "Cédric Mbarga", role: "user" }, { openId: "pro-other", name: "Autre Pro", role: "user" },
      { openId: "client-1", name: "Esther Client", role: "user" }, { openId: "admin-1", name: "Admin", role: "admin" },
    ]);
    const all = await db.select().from(users);
    const find = (openId: string) => all.find((user) => user.openId === openId)!;
    [pro, other, client, admin] = [find("pro-cedric"), find("pro-other"), find("client-1"), find("admin-1")];
    // Le profil de démonstration de Cédric est rattaché à son compte.
    await db.update(professionalProfiles).set({ ownerUserId: pro.id }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
  });

  const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
    customerUserId: client.id, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 50, timezone: "Africa/Douala",
    mode: "salon", customerName: "Esther Client", customerPhone: "690000001", serviceIds: ["cedric-fade"], totalXaf: 7000, ...overrides,
  });

  describe("inscription", () => {
    it("crée un profil en attente, rattaché au compte, avec des horaires par défaut", async () => {
      expect(await getMyProfessional(db, other.id)).toBeNull();
      const { slug } = await applyAsProfessional(db, other.id, { displayName: "Aïcha Bello", city: "Garoua", mode: "salon", specialties: ["Onglerie", "Onglerie", " Pose "] }, NOW);
      expect(slug).toBe("aicha-bello");
      const me = await getMyProfessional(db, other.id);
      expect(me).toMatchObject({ status: "pending", city: "Garoua", specialties: ["Onglerie", "Pose"], weeklyHours: { "1": { open: "09:00", close: "18:00" } } });
      await expect(applyAsProfessional(db, other.id, { displayName: "Encore", city: "Douala", mode: "salon" }, NOW)).rejects.toThrow("ALREADY_PROFESSIONAL");
      // Sans prestation, le profil n’apparaît pas encore dans la recherche.
      expect((await searchCatalog(db)).some((item) => item.slug === slug)).toBe(false);
      await saveService(db, other.id, { name: "Pose gel", category: "Ongles", durationMinutes: 90, priceXaf: 12000 });
      expect((await searchCatalog(db)).some((item) => item.slug === slug)).toBe(true);
      // Un deuxième pro au même nom reçoit une adresse distincte.
      const third = await applyAsProfessional(db, client.id, { displayName: "Aïcha Bello", city: "Douala", mode: "domicile" }, NOW);
      expect(third.slug).toMatch(/^aicha-bello-[a-z0-9x]{5}$/);
    });

    it("un profil refusé repasse en attente quand il est corrigé", async () => {
      await applyAsProfessional(db, other.id, { displayName: "Studio Test", city: "Douala", mode: "salon" }, NOW);
      await setProfessionalStatus(db, admin.id, { slug: "studio-test", action: "refuse", reason: "Photos non conformes" });
      expect(await getMyProfessional(db, other.id)).toMatchObject({ status: "refused", statusNote: "Photos non conformes" });
      expect(await updateMyProfile(db, other.id, { displayName: "Studio Test", city: "Douala", mode: "salon", bio: "Nouvelles photos" })).toMatchObject({ status: "pending" });
      expect(await getMyProfessional(db, other.id)).toMatchObject({ status: "pending", statusNote: null, bio: "Nouvelles photos" });
    });

    it("WhatsApp et position : validés, publiés, et conservés si l’application ne les envoie pas", async () => {
      const base = { displayName: "Cédric Mbarga", salonName: "Cédric Studio", city: "Yaoundé", neighborhood: "Bastos", mode: "salon" as const };
      await expect(updateMyProfile(db, pro.id, { ...base, whatsapp: "12345" })).rejects.toThrow("WHATSAPP_INVALID");
      await expect(updateMyProfile(db, pro.id, { ...base, location: { lat: 0, lng: 0 } })).rejects.toThrow("LOCATION_INVALID");
      await updateMyProfile(db, pro.id, { ...base, whatsapp: "6 90 12 34 56", location: { lat: 3.8794, lng: 11.5138 } });
      expect(await getMyProfessional(db, pro.id)).toMatchObject({ whatsapp: "+237690123456", location: { lat: 3.8794, lng: 11.5138 } });
      expect(await getProfessional(db, "cedric-mbarga")).toMatchObject({ whatsapp: "+237690123456", location: { lat: 3.8794, lng: 11.5138 } });
      // Champs absents : rien ne change. Champs vidés : retirés.
      await updateMyProfile(db, pro.id, { ...base, bio: "Bio" });
      expect(await getMyProfessional(db, pro.id)).toMatchObject({ whatsapp: "+237690123456", location: { lat: 3.8794, lng: 11.5138 } });
      await updateMyProfile(db, pro.id, { ...base, whatsapp: "", location: null });
      expect(await getMyProfessional(db, pro.id)).toMatchObject({ whatsapp: "", location: null });
    });

    it("filtre la recherche par quartier, sans tenir compte des accents ni des majuscules", async () => {
      expect(await listNeighborhoods(db, "Yaoundé")).toContain("Bastos");
      const inBastos = await searchCatalog(db, { city: "Yaoundé", neighborhood: "bastos" });
      expect(inBastos.map((item) => item.slug)).toContain("cedric-mbarga");
      expect(inBastos.every((item) => item.neighborhood.toLowerCase() === "bastos")).toBe(true);
      expect(await searchCatalog(db, { neighborhood: "Quartier inexistant" })).toEqual([]);
    });
  });

  describe("prestations", () => {
    it("ajoute, modifie et désactive ses seules prestations", async () => {
      const { id } = await saveService(db, pro.id, { name: "Contour barbe", durationMinutes: 20, priceXaf: 2000 });
      await saveService(db, pro.id, { id, name: "Contour de barbe", durationMinutes: 25, priceXaf: 2500 });
      expect((await getMyProfessional(db, pro.id))?.services.find((service) => service.id === id)).toMatchObject({ name: "Contour de barbe", durationMinutes: 25, priceXaf: 2500, active: true });
      await expect(saveService(db, pro.id, { name: "X", durationMinutes: 5, priceXaf: 10 })).rejects.toThrow("SERVICE_INVALID");
      await applyAsProfessional(db, other.id, { displayName: "Concurrent", city: "Yaoundé", mode: "salon" }, NOW);
      await expect(saveService(db, other.id, { id, name: "Piratage", durationMinutes: 30, priceXaf: 1000 })).rejects.toThrow("SERVICE_NOT_FOUND");
      await expect(setServiceActive(db, other.id, { id: "cedric-fade", active: false })).rejects.toThrow("SERVICE_NOT_FOUND");
      await setServiceActive(db, pro.id, { id: "cedric-fade", active: false });
      await expect(createBooking(db, booking(), NOW)).rejects.toThrow("SERVICE_NOT_FOUND");
      await expect(saveService(db, client.id, { name: "Sans profil", durationMinutes: 30, priceXaf: 1000 })).rejects.toThrow("NO_PROFESSIONAL_PROFILE");
    });
  });

  describe("horaires et congés", () => {
    it("régénère les créneaux selon les nouveaux horaires et signale les réservations hors horaires", async () => {
      await createBooking(db, booking({ startsAt: at(MONDAY, "18:30") }), NOW);
      await expect(setWeeklyHours(db, pro.id, { "1": { open: "18:00", close: "09:00" } }, NOW)).rejects.toThrow("HOURS_INVALID");
      const result = await setWeeklyHours(db, pro.id, { "0": { open: "10:00", close: "14:00" }, "1": { open: "08:00", close: "12:00" } }, NOW);
      expect(result.bookingsOutsideHours).toBe(1);
      const sunday = await getFreeSlots(db, { slug: "cedric-mbarga", day: SUNDAY, serviceIds: ["cedric-fade"], now: NOW });
      expect(sunday.startsAt[0]).toBe(at(SUNDAY, "10:00"));
      expect((await getFreeSlots(db, { slug: "cedric-mbarga", day: TUESDAY, serviceIds: ["cedric-fade"], now: NOW })).startsAt).toEqual([]);
      await expect(createBooking(db, booking({ customerUserId: null, startsAt: at(MONDAY, "15:00") }), NOW)).rejects.toThrow("SLOT_OUTSIDE_HOURS");
    });

    it("pose un congé, signale les rendez-vous concernés et le retire", async () => {
      const taken = await createBooking(db, booking(), NOW);
      const { affectedBookings } = await addClosure(db, pro.id, { startsAt: doualaDateTime(MONDAY, "00:00").toISOString(), endsAt: doualaDateTime(TUESDAY, "00:00").toISOString(), status: "leave", note: "Mariage" }, NOW);
      expect(affectedBookings).toEqual([taken.reference]);
      expect((await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-fade"], now: NOW })).startsAt).toEqual([]);
      const closures = await listClosures(db, pro.id, NOW);
      expect(closures).toHaveLength(1);
      await expect(removeClosure(db, other.id, closures[0].id)).rejects.toThrow("NO_PROFESSIONAL_PROFILE");
      await removeClosure(db, pro.id, closures[0].id);
      expect((await getFreeSlots(db, { slug: "cedric-mbarga", day: MONDAY, serviceIds: ["cedric-fade"], now: NOW })).startsAt.length).toBeGreaterThan(0);
      await expect(addClosure(db, pro.id, { startsAt: at(TUESDAY, "12:00"), endsAt: at(TUESDAY, "10:00"), status: "blocked" }, NOW)).rejects.toThrow("INVALID_TIME_RANGE");
    });
  });

  describe("demandes", () => {
    it("confirme, refuse avec motif, et ne termine un rendez-vous qu’une fois l’heure passée", async () => {
      const a = await createBooking(db, booking(), NOW);
      const b = await createBooking(db, booking({ startsAt: at(MONDAY, "14:00") }), NOW);
      expect((await listMyBookings(db, pro.id, { scope: "pending" }, NOW)).map((item) => item.reference)).toEqual([a.reference, b.reference]);

      const confirmed = await transitionMyBooking(db, pro.id, { reference: a.reference, to: "confirmed" }, NOW);
      expect(confirmed.allowedTransitions).toEqual(["cancelled"]);
      expect((await getBookingsForUser(db, client.id)).find((item) => item.reference === a.reference)?.status).toBe("confirmed");
      await expect(transitionMyBooking(db, pro.id, { reference: b.reference, to: "refused" }, NOW)).rejects.toThrow("REASON_REQUIRED");
      await transitionMyBooking(db, pro.id, { reference: b.reference, to: "refused", note: "Indisponible ce jour-là" }, NOW);

      await expect(transitionMyBooking(db, pro.id, { reference: a.reference, to: "completed" }, NOW)).rejects.toThrow("INVALID_TRANSITION");
      const later = doualaDateTime(MONDAY, "11:00");
      expect((await listMyBookings(db, pro.id, { scope: "upcoming" }, NOW)).map((item) => item.reference)).toEqual([a.reference]);
      const done = await transitionMyBooking(db, pro.id, { reference: a.reference, to: "completed" }, later);
      expect(done.events.map((event) => event.toStatus)).toEqual(["pending", "confirmed", "completed"]);
      expect((await listMyBookings(db, pro.id, { scope: "past" }, later)).map((item) => item.reference)).toContain(a.reference);

      const overview = await getMyOverview(db, pro.id, later);
      expect(overview).toMatchObject({ pendingRequests: 0, completedThisMonth: 1, revenueThisMonthXaf: 7000, activeServices: 3, hasHours: true });
    });

    it("ne voit et ne modifie que ses propres réservations, et rien s’il est suspendu", async () => {
      const mine = await createBooking(db, booking(), NOW);
      await applyAsProfessional(db, other.id, { displayName: "Concurrent", city: "Yaoundé", mode: "salon" }, NOW);
      expect(await listMyBookings(db, other.id, { scope: "pending" }, NOW)).toEqual([]);
      await expect(transitionMyBooking(db, other.id, { reference: mine.reference, to: "confirmed" }, NOW)).rejects.toThrow("BOOKING_NOT_FOUND");
      await setProfessionalStatus(db, admin.id, { slug: "cedric-mbarga", action: "suspend", reason: "Contrôle" });
      await expect(transitionMyBooking(db, pro.id, { reference: mine.reference, to: "confirmed" }, NOW)).rejects.toThrow("PROFESSIONAL_SUSPENDED");
    });
  });

  it("expose l’espace pro par l’API au seul compte connecté", async () => {
    process.env.DATABASE_URL = url;
    const caller = (user: User | null) => appRouter.createCaller({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
    await expect(caller(null).pro.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(client).pro.me()).resolves.toBeNull();
    await expect(caller(client).pro.overview()).rejects.toMatchObject({ code: "NOT_FOUND", message: "NO_PROFESSIONAL_PROFILE" });
    await expect(caller(pro).pro.me()).resolves.toMatchObject({ slug: "cedric-mbarga" });
    await expect(caller(pro).pro.setWeeklyHours({ "1": { open: "25:00", close: "26:00" } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
