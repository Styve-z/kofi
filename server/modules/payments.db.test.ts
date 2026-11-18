/** Circuit de paiement (prestataire de test) contre une vraie base. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, payments, professionalProfiles, users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { transitionBooking } from "./admin";
import { cancelBooking, createBooking, getBookingsForUser, type CreateBookingInput } from "./booking";
import { listNotifications } from "./notifications";
import { amountDue, getPaymentProvider, setPaymentProviderForTests } from "./payments/config";
import { applyPaymentEvent, getMyEarnings, initiatePayment, listPaymentsForStaff, recordPayout } from "./payments/index";
import { sign, testProvider } from "./payments/provider";
import { transitionMyBooking } from "./pro";
import { doualaDateTime } from "./time";

describe("réglages du paiement", () => {
  it("calcule l’acompte arrondi aux 50 FCFA supérieurs", () => {
    expect(amountDue(18_000, { enabled: true, testMode: true, mode: "full", depositPercent: 30, freeCancelHours: 24, commissionPercent: 10 })).toBe(18_000);
    expect(amountDue(7_000, { enabled: true, testMode: true, mode: "deposit", depositPercent: 30, freeCancelHours: 24, commissionPercent: 10 })).toBe(2_100);
    expect(amountDue(7_010, { enabled: true, testMode: true, mode: "deposit", depositPercent: 33, freeCancelHours: 24, commissionPercent: 10 })).toBe(2_350);
  });

  it("interdit le mode test en production", () => {
    const saved = { provider: process.env.PAYMENT_PROVIDER, env: process.env.NODE_ENV };
    setPaymentProviderForTests(undefined);
    process.env.PAYMENT_PROVIDER = "test";
    process.env.NODE_ENV = "production";
    expect(getPaymentProvider()).toBeNull();
    process.env.NODE_ENV = "development";
    expect(getPaymentProvider()?.test).toBe(true);
    process.env.PAYMENT_PROVIDER = saved.provider; process.env.NODE_ENV = saved.env;
  });

  it("vérifie la signature des webhooks", () => {
    const provider = testProvider();
    const body = Buffer.from(JSON.stringify({ providerReference: "TEST-1", status: "succeeded" }));
    expect(provider.parseWebhook(body, { "x-kofi-signature": sign(body, "kofi-test-webhook-secret") })).toEqual({ providerReference: "TEST-1", status: "succeeded", failureReason: undefined });
    expect(provider.parseWebhook(body, { "x-kofi-signature": sign(body, "mauvais-secret") })).toBeNull();
    expect(provider.parseWebhook(body, {})).toBeNull();
  });
});

describe.skipIf(!url)("paiement Mobile Money en mode test (base réelle)", () => {
  let db: Database;
  let client: User; let pro: User; let admin: User;
  const LATER = doualaDateTime(MONDAY, "12:00");
  beforeAll(async () => { process.env.DATABASE_URL = url; db = await openTestDb(); }, 60_000);
  afterAll(async () => { setPaymentProviderForTests(undefined); await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    setPaymentProviderForTests(testProvider());
    await db.insert(users).values([{ openId: "c1", name: "Amina Njoya", role: "user" }, { openId: "p1", name: "Cédric", role: "user" }, { openId: "a1", name: "Admin", role: "admin" }]);
    const all = await db.select().from(users);
    [client, pro, admin] = ["c1", "p1", "a1"].map((openId) => all.find((user) => user.openId === openId)!);
    await db.update(professionalProfiles).set({ ownerUserId: pro.id }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
  });
  const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({ customerUserId: client.id, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 75, timezone: "Africa/Douala", mode: "salon", customerName: "Amina Njoya", customerPhone: "690000001", serviceIds: ["cedric-duo"], totalXaf: 10_000, ...overrides });
  const confirmed = async (overrides: Partial<CreateBookingInput> = {}) => {
    const created = await createBooking(db, booking(overrides), NOW);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    return created;
  };
  const pay = async (reference: string) => {
    const started = await initiatePayment(db, client.id, { reference, operator: "mtn", phone: "6 90 00 00 01" });
    const [row] = await db.select().from(payments).where(eq(payments.id, started.paymentId));
    return { started, row };
  };
  const mine = async (reference: string) => (await getBookingsForUser(db, client.id)).find((item) => item.reference === reference)!;

  it("le client paie après la confirmation ; le paiement n’est validé que par l’événement du prestataire, une seule fois", async () => {
    const pending = await createBooking(db, booking(), NOW);
    await expect(initiatePayment(db, client.id, { reference: pending.reference, operator: "mtn", phone: "690000001" })).rejects.toThrow("PAYMENT_NOT_DUE");
    await transitionMyBooking(db, pro.id, { reference: pending.reference, to: "confirmed" }, NOW);
    expect(await mine(pending.reference)).toMatchObject({ paymentStatus: "unpaid", amountDueXaf: 10_000, amountPaidXaf: 0 });
    const { started, row } = await pay(pending.reference);
    expect(started).toMatchObject({ status: "pending", testMode: true });
    expect(row).toMatchObject({ amountXaf: 10_000, payerPhone: "+237690000001", operator: "mtn" });
    // Deux clics : la même demande est réutilisée.
    expect((await initiatePayment(db, client.id, { reference: pending.reference, operator: "mtn", phone: "690000001" })).paymentId).toBe(started.paymentId);
    expect(await applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" })).toEqual({ applied: true, reason: "ok" });
    expect(await applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" })).toEqual({ applied: false, reason: "already_final" });
    expect(await applyPaymentEvent(db, { providerReference: row.providerReference, status: "failed" })).toEqual({ applied: false, reason: "already_final" });
    expect(await applyPaymentEvent(db, { providerReference: "INCONNU", status: "succeeded" })).toEqual({ applied: false, reason: "unknown" });
    expect(await mine(pending.reference)).toMatchObject({ paymentStatus: "paid", amountPaidXaf: 10_000 });
    expect((await listNotifications(db, pro.id))[0].title).toBe("Paiement reçu");
    expect((await listNotifications(db, client.id))[0].title).toBe("Paiement confirmé");
    await expect(initiatePayment(db, client.id, { reference: pending.reference, operator: "mtn", phone: "690000001" })).rejects.toThrow("PAYMENT_NOT_DUE");
  });

  it("le même événement reçu 6 fois en même temps n’est compté qu’une fois", async () => {
    const created = await confirmed();
    const { row } = await pay(created.reference);
    const results = await Promise.all(Array.from({ length: 6 }, () => applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" })));
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(await mine(created.reference)).toMatchObject({ paymentStatus: "paid", amountPaidXaf: 10_000 });
    expect((await listNotifications(db, client.id)).filter((item) => item.title === "Paiement confirmé")).toHaveLength(1);
  });

  it("un paiement refusé peut être retenté ; un autre client ne peut pas payer à sa place", async () => {
    const created = await confirmed();
    await expect(initiatePayment(db, pro.id, { reference: created.reference, operator: "orange", phone: "690000001" })).rejects.toThrow("BOOKING_NOT_FOUND");
    const first = await pay(created.reference);
    await applyPaymentEvent(db, { providerReference: first.row.providerReference, status: "failed", failureReason: "Solde insuffisant" });
    expect((await listNotifications(db, client.id))[0]).toMatchObject({ title: "Paiement non abouti" });
    expect(await mine(created.reference)).toMatchObject({ paymentStatus: "unpaid" });
    const second = await pay(created.reference);
    expect(second.started.paymentId).not.toBe(first.started.paymentId);
  });

  it("annulation gratuite plus de 24 h avant : remboursement intégral", async () => {
    const created = await confirmed();
    const { row } = await pay(created.reference);
    await applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" });
    await expect(cancelBooking(db, created.reference, client.id, doualaDateTime("2030-05-05", "12:00"))).rejects.toThrow("CANCELLATION_TOO_LATE");
    await cancelBooking(db, created.reference, client.id, doualaDateTime("2030-05-04", "12:00"));
    expect(await mine(created.reference)).toMatchObject({ status: "cancelled", paymentStatus: "refund_pending" });
    const [refund] = await db.select().from(payments).where(eq(payments.kind, "refund"));
    expect(refund).toMatchObject({ amountXaf: 10_000, status: "pending" });
    await applyPaymentEvent(db, { providerReference: refund.providerReference, status: "succeeded" });
    expect(await mine(created.reference)).toMatchObject({ paymentStatus: "refunded", amountPaidXaf: 0 });
    expect((await listNotifications(db, client.id))[0].title).toBe("Remboursement effectué");
  });

  it("annulation par le professionnel ou KOFI : toujours remboursé ; non payé : plus rien n’est dû", async () => {
    const paid = await confirmed();
    const { row } = await pay(paid.reference);
    await applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" });
    await transitionBooking(db, admin.id, { reference: paid.reference, to: "cancelled", note: "Salon fermé" });
    expect(await mine(paid.reference)).toMatchObject({ paymentStatus: "refund_pending" });
    const unpaid = await confirmed({ startsAt: at(MONDAY, "14:00") });
    await transitionMyBooking(db, pro.id, { reference: unpaid.reference, to: "cancelled", note: "Imprévu" }, NOW);
    expect(await mine(unpaid.reference)).toMatchObject({ paymentStatus: "none" });
  });

  it("paiement reçu après une annulation : remboursé automatiquement", async () => {
    const created = await confirmed();
    const { row } = await pay(created.reference);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "cancelled", note: "Imprévu" }, NOW);
    await applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" });
    expect(await mine(created.reference)).toMatchObject({ paymentStatus: "refund_pending", amountPaidXaf: 10_000 });
    expect((await db.select().from(payments).where(eq(payments.kind, "refund")))).toHaveLength(1);
  });

  it("commission figée à la fin du rendez-vous, solde du pro et reversements plafonnés", async () => {
    const created = await confirmed();
    const { row } = await pay(created.reference);
    await applyPaymentEvent(db, { providerReference: row.providerReference, status: "succeeded" });
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "completed" }, LATER);
    const [stored] = await db.select().from(bookings).where(eq(bookings.reference, created.reference));
    expect(stored.commissionXaf).toBe(1_000);
    expect(await getMyEarnings(db, pro.id)).toMatchObject({ collectedXaf: 10_000, commissionXaf: 1_000, netXaf: 9_000, balanceXaf: 9_000 });
    await expect(recordPayout(db, admin.id, { slug: "cedric-mbarga", amountXaf: 9_500 })).rejects.toThrow("PAYOUT_INVALID");
    await recordPayout(db, admin.id, { slug: "cedric-mbarga", amountXaf: 9_000, note: "Virement MoMo du 07/05" });
    expect(await getMyEarnings(db, pro.id)).toMatchObject({ paidOutXaf: 9_000, balanceXaf: 0 });
    expect((await listNotifications(db, pro.id))[0].title).toBe("Reversement envoyé");
    const unpaid = await confirmed({ startsAt: at(MONDAY, "15:00") });
    await transitionMyBooking(db, pro.id, { reference: unpaid.reference, to: "completed" }, doualaDateTime(MONDAY, "17:00"));
    expect(await getMyEarnings(db, pro.id)).toMatchObject({ collectedXaf: 10_000, balanceXaf: 0 });
    const staff = await listPaymentsForStaff(db);
    expect(staff.totals.collectedXaf).toBe(10_000);
    expect(staff.balances[0]).toMatchObject({ professional: { slug: "cedric-mbarga" }, balanceXaf: 0 });
  });

  it("droits : simulation réservée au mode test, back-office réservé à l’équipe", async () => {
    const created = await confirmed();
    const { started } = await pay(created.reference);
    const caller = (user: User) => appRouter.createCaller({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
    await expect(caller(pro).payments.simulate({ paymentId: started.paymentId, outcome: "succeeded" })).rejects.toMatchObject({ message: "PAYMENT_NOT_FOUND" });
    await expect(caller(client).payments.simulate({ paymentId: started.paymentId, outcome: "succeeded" })).resolves.toMatchObject({ status: "succeeded", bookingPaymentStatus: "paid" });
    await expect(caller(client).admin.payments.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller({ ...admin, role: "support" }).admin.payments.recordPayout({ slug: "cedric-mbarga", amountXaf: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    setPaymentProviderForTests(null);
    await expect(caller(client).payments.config()).resolves.toMatchObject({ enabled: false });
    const later = await confirmed({ startsAt: at(MONDAY, "15:00") });
    expect(await mine(later.reference)).toMatchObject({ paymentStatus: "none" });
  });
});
