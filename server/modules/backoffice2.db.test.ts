/** Back-office V2 : rôles de l’équipe, codes promo, signalements (base réelle). */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { createPromotion, listAudit, setPromotionEnabled, setUserRole, transitionBooking } from "./admin";
import { cancelBooking, createBooking, type CreateBookingInput } from "./booking";
import { computeDiscount, evaluatePromo, listPromotions } from "./promo";
import { createReport, listMyReports, listReports, updateReport } from "./reports";
import { doualaDateTime } from "./time";

describe("computeDiscount", () => {
  it("plafonne la remise au montant", () => {
    expect(computeDiscount({ discountType: "percentage", discountValue: 15 }, 10000)).toBe(1500);
    expect(computeDiscount({ discountType: "fixed", discountValue: 5000 }, 4000)).toBe(4000);
  });
});

describe.skipIf(!url)("back-office V2 (base réelle)", () => {
  let db: Database;
  const staff: Record<string, User> = {};

  beforeAll(async () => { db = await openTestDb(); process.env.DATABASE_URL = url; }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    await db.insert(users).values([
      { openId: "u-admin", name: "Super Admin", role: "admin" }, { openId: "u-mod", name: "Modo", role: "moderator" },
      { openId: "u-support", name: "Support", role: "support" }, { openId: "u-client", name: "Cliente", role: "user" }, { openId: "u-client2", name: "Client 2", role: "user" },
    ]);
    for (const user of await db.select().from(users)) staff[user.openId] = user;
  });

  const caller = (user: User | null) => appRouter.createCaller({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
  const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
    customerUserId: staff["u-client"].id, professionalSlug: "mireille-nkoulou", startsAt: at(MONDAY, "10:00"), durationMinutes: 150, timezone: "Africa/Douala",
    mode: "salon", customerName: "Cliente", customerPhone: "690000001", serviceIds: ["mireille-twist"], totalXaf: 18000, ...overrides,
  });
  const promo = (code: string, overrides = {}) => createPromotion(db, staff["u-admin"].id, {
    code, label: "Offre de lancement", discountType: "percentage", discountValue: 10, startsAt: doualaDateTime("2030-04-01", "00:00").toISOString(), endsAt: doualaDateTime("2030-06-30", "23:59").toISOString(), onePerCustomer: true, ...overrides,
  });

  describe("rôles de l’équipe", () => {
    it("applique les permissions de chaque niveau côté serveur", async () => {
      const [support, mod, admin, client] = [caller(staff["u-support"]), caller(staff["u-mod"]), caller(staff["u-admin"]), caller(staff["u-client"])];
      await expect(client.admin.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await support.admin.me()).permissions).toEqual(expect.arrayContaining(["bookings.manage", "reports.manage"]));
      expect((await support.admin.me()).permissions).not.toContain("professionals.manage");
      // Support : gère les réservations, pas le catalogue ni les suspensions.
      await expect(support.admin.professionals.setStatus({ slug: "sandra-essomba", action: "validate" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(support.admin.users.setStatus({ userId: staff["u-client"].id, status: "suspended", reason: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const created = await createBooking(db, booking(), NOW);
      await expect(support.admin.bookings.transition({ reference: created.reference, to: "confirmed" })).resolves.toMatchObject({ status: "confirmed" });
      // Modérateur : valide les professionnels, ne touche pas aux réservations ni aux codes promo.
      await expect(mod.admin.professionals.setStatus({ slug: "sandra-essomba", action: "validate" })).resolves.toMatchObject({ status: "verified" });
      await expect(mod.admin.bookings.transition({ reference: created.reference, to: "completed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(mod.admin.promotions.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Seul le super-administrateur gère les rôles et les codes.
      await expect(mod.admin.users.setRole({ userId: staff["u-client"].id, role: "support" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(admin.admin.users.setRole({ userId: staff["u-admin"].id, role: "user" })).rejects.toMatchObject({ message: "CANNOT_CHANGE_OWN_ROLE" });
      await expect(admin.admin.users.setRole({ userId: staff["u-client"].id, role: "support" })).resolves.toMatchObject({ role: "support" });
      const [promoted] = await db.select().from(users).where(eq(users.id, staff["u-client"].id));
      await expect(caller(promoted).admin.overview()).resolves.toMatchObject({ reportsOpen: 0 });
      expect((await listAudit(db))[0]).toMatchObject({ action: "Rôle modifié", detail: "Client → Support" });
    });
  });

  describe("codes promo", () => {
    it("applique la remise à la réservation et la refuse hors conditions", async () => {
      await promo("BIENVENUE");
      // Hors période à la date réelle : la vérification d’aujourd’hui est refusée, sans erreur technique.
      await expect(caller(staff["u-client"]).promo.check({ code: " bienvenue ", slug: "mireille-nkoulou", serviceIds: ["mireille-twist"] })).resolves.toEqual({ valid: false, reason: "PROMO_EXPIRED" });
      const result = await evaluatePromo(db, { code: "bienvenue", subtotalXaf: 18000, customerUserId: staff["u-client"].id, now: NOW });
      expect(result).toMatchObject({ discountXaf: 1800, totalXaf: 16200 });
      const created = await createBooking(db, booking({ promoCode: "BIENVENUE" }), NOW);
      expect(created).toMatchObject({ subtotalXaf: 18000, discountXaf: 1800, totalXaf: 16200, promoCode: "BIENVENUE" });
      await expect(createBooking(db, booking({ startsAt: at(MONDAY, "14:00"), promoCode: "BIENVENUE" }), NOW)).rejects.toThrow("PROMO_ALREADY_USED");
      await expect(createBooking(db, booking({ startsAt: at(MONDAY, "14:00"), promoCode: "INCONNU" }), NOW)).rejects.toThrow("PROMO_INVALID");
      await promo("GROS", { discountType: "fixed", discountValue: 3000, minSubtotalXaf: 15000, onePerCustomer: false });
      await expect(createBooking(db, booking({ serviceIds: ["mireille-coupe"], durationMinutes: 60, totalXaf: 8000, startsAt: at(MONDAY, "14:00"), promoCode: "GROS" }), NOW)).rejects.toThrow("PROMO_MIN_TOTAL");
      await expect(evaluatePromo(db, { code: "BIENVENUE", subtotalXaf: 18000, customerUserId: staff["u-client2"].id, now: doualaDateTime("2030-07-02", "10:00") })).rejects.toThrow("PROMO_EXPIRED");
      await expect(evaluatePromo(db, { code: "BIENVENUE", subtotalXaf: 18000, customerUserId: staff["u-client2"].id, now: doualaDateTime("2030-03-31", "10:00") })).rejects.toThrow("PROMO_EXPIRED");
    });

    it("respecte le nombre maximal d’utilisations, même en simultané, et une annulation libère le code", async () => {
      const { id } = await promo("FLASH", { maxUses: 2, onePerCustomer: false });
      // Quatre professionnels différents : seul le verrou du code promo peut empêcher le dépassement.
      const choices: Partial<CreateBookingInput>[] = [
        { professionalSlug: "cedric-mbarga", serviceIds: ["cedric-fade"], durationMinutes: 50, totalXaf: 7000 },
        { professionalSlug: "mireille-nkoulou", serviceIds: ["mireille-coupe"], durationMinutes: 60, totalXaf: 8000 },
        { professionalSlug: "joelle-ndongo", serviceIds: ["joelle-enfant"], durationMinutes: 60, totalXaf: 6000, mode: "domicile", address: "Quartier Tamdja, Bafoussam" },
        { professionalSlug: "sandra-essomba", serviceIds: ["sandra-brush"], durationMinutes: 60, totalXaf: 9000, startsAt: at("2030-05-07", "10:00") },
      ];
      const attempts = await Promise.allSettled(choices.map((choice, index) => createBooking(db, booking({ customerUserId: staff["u-client2"].id, customerName: `Client ${index}`, ...choice, promoCode: "FLASH" }), NOW)));
      const ok = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof createBooking>>> => attempt.status === "fulfilled");
      expect(ok).toHaveLength(2);
      expect(attempts.filter((attempt) => attempt.status === "rejected").every((attempt) => (attempt as PromiseRejectedResult).reason.message === "PROMO_EXHAUSTED")).toBe(true);
      expect((await listPromotions(db, NOW)).find((item) => item.code === "FLASH")).toMatchObject({ uses: 2, state: "exhausted" });
      await cancelBooking(db, ok[0].value.reference, staff["u-client2"].id);
      expect((await listPromotions(db, NOW)).find((item) => item.code === "FLASH")).toMatchObject({ uses: 1, state: "active" });
      await setPromotionEnabled(db, staff["u-admin"].id, { id, enabled: false });
      await expect(createBooking(db, booking({ startsAt: at(MONDAY, "14:00"), promoCode: "FLASH" }), NOW)).rejects.toThrow("PROMO_INVALID");
      await expect(promo("FLASH")).rejects.toThrow("PROMO_CODE_TAKEN");
      await expect(promo("X")).rejects.toThrow("PROMO_INPUT_INVALID");
    }, 30_000);
  });

  describe("signalements", () => {
    it("un client signale sa réservation, l’équipe la traite avec une réponse", async () => {
      const created = await createBooking(db, booking(), NOW);
      await transitionBooking(db, staff["u-admin"].id, { reference: created.reference, to: "confirmed" });
      await expect(createReport(db, staff["u-client2"].id, { bookingReference: created.reference, category: "quality", message: "Pas ma réservation mais je signale" })).rejects.toThrow("BOOKING_NOT_FOUND");
      await expect(createReport(db, staff["u-client"].id, { category: "other", message: "court" })).rejects.toThrow("REPORT_INVALID");
      const { id } = await createReport(db, staff["u-client"].id, { bookingReference: created.reference, category: "no_show_pro", message: "La coiffeuse n’est pas venue au rendez-vous." });
      const list = await listReports(db, { status: "open" });
      expect(list.counts.open).toBe(1);
      expect(list.items[0]).toMatchObject({ reporter: "Cliente", booking: { reference: created.reference }, professional: { name: "Mireille Nkoulou" } });
      await updateReport(db, staff["u-support"].id, { id, status: "in_progress" });
      await expect(updateReport(db, staff["u-support"].id, { id, status: "resolved" })).rejects.toThrow("REASON_REQUIRED");
      await updateReport(db, staff["u-support"].id, { id, status: "resolved", note: "Rendez-vous remboursé et professionnelle avertie." });
      expect((await listMyReports(db, staff["u-client"].id))[0]).toMatchObject({ status: "resolved", resolutionNote: "Rendez-vous remboursé et professionnelle avertie.", handledBy: "Support" });
      expect((await listAudit(db)).slice(0, 2).map((entry) => entry.action)).toEqual(["Signalement résolu", "Signalement pris en charge"]);
    });

    it("limite le nombre de signalements par jour", async () => {
      for (let index = 0; index < 10; index++) await createReport(db, staff["u-client"].id, { category: "other", message: `Signalement numéro ${index}` });
      await expect(createReport(db, staff["u-client"].id, { category: "other", message: "Un de trop aujourd’hui" })).rejects.toThrow("REPORT_LIMIT");
    });
  });
});
