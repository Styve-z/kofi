/** E-mails, SMS, rappels et vérification de l’adresse (base réelle). */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, messageOutbox, professionalProfiles, users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { createBooking, type CreateBookingInput } from "./booking";
import { resetVerificationRateLimit, sendVerificationEmail, verifyEmail } from "./emailVerification";
import { setMailProviderForTests, type Email } from "./mailer";
import { dispatchOutbox } from "./messaging";
import { transitionMyBooking } from "./pro";
import { sendDueReminders } from "./reminders";
import { normalizeCameroonPhone, setSmsProviderForTests, type Sms } from "./sms";
import { doualaDateTime } from "./time";

describe("numéros camerounais", () => {
  it("normalise les formats courants et refuse le reste", () => {
    expect(normalizeCameroonPhone("6 90 00 00 01")).toBe("+237690000001");
    expect(normalizeCameroonPhone("+237 690-000-001")).toBe("+237690000001");
    expect(normalizeCameroonPhone("00237690000001")).toBe("+237690000001");
    expect(normalizeCameroonPhone("22 22 22 22")).toBeNull();
    expect(normalizeCameroonPhone("abc")).toBeNull();
  });
});

describe.skipIf(!url)("messages et rappels (base réelle)", () => {
  let db: Database;
  let client: User; let pro: User;
  let emails: Email[] = []; let texts: Sms[] = [];
  const outbox = () => db.select().from(messageOutbox);
  const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";
  const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({ customerUserId: client.id, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 75, timezone: "Africa/Douala", mode: "salon", customerName: "Amina Njoya", customerPhone: "690000001", serviceIds: ["cedric-duo"], totalXaf: 10_000, ...overrides });

  beforeAll(async () => { process.env.DATABASE_URL = url; db = await openTestDb(); }, 60_000);
  afterAll(async () => { setMailProviderForTests(undefined); setSmsProviderForTests(undefined); await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    resetVerificationRateLimit();
    emails = []; texts = [];
    setMailProviderForTests({ name: "memoire", send: async (email) => { emails.push(email); } });
    setSmsProviderForTests({ name: "memoire", send: async (sms) => { texts.push(sms); } });
    await db.insert(users).values([
      { openId: "c1", name: "Amina", email: "amina@kofi.test", role: "user", emailVerifiedAt: NOW },
      { openId: "p1", name: "Cédric", email: "cedric@kofi.test", role: "user" },
    ]);
    const all = await db.select().from(users);
    client = all.find((user) => user.openId === "c1")!; pro = all.find((user) => user.openId === "p1")!;
    await db.update(professionalProfiles).set({ ownerUserId: pro.id }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
  });
  afterEach(() => { setMailProviderForTests(undefined); setSmsProviderForTests(undefined); });

  it("une réservation prévient par e-mail (adresse vérifiée seulement) et par SMS, après coup", async () => {
    const created = await createBooking(db, booking(), NOW);
    let queued = await outbox();
    // Client vérifié : e-mail + SMS ; pro non vérifié : notification dans le site seulement.
    expect(queued.map((row) => `${row.channel}:${row.recipient}`).sort()).toEqual(["email:amina@kofi.test", "sms:+237690000001"]);
    expect(queued.find((row) => row.channel === "sms")!.body).toContain(created.reference);
    expect(emails).toHaveLength(0); // rien ne part pendant la transaction
    await dispatchOutbox(db, NOW);
    expect(emails.map((email) => email.to)).toEqual(["amina@kofi.test"]);
    expect(texts.map((sms) => sms.to)).toEqual(["+237690000001"]);
    queued = await outbox();
    expect(queued.every((row) => row.status === "sent")).toBe(true);
    // Deuxième passage : rien n’est renvoyé.
    await dispatchOutbox(db, NOW);
    expect(emails).toHaveLength(1);

    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    await dispatchOutbox(db, NOW);
    expect(texts.at(-1)!.text).toContain("confirmé");
    expect(emails.at(-1)!.subject).toContain("Rendez-vous confirmé");
  });

  it("réessaie un envoi en échec puis abandonne après 5 essais", async () => {
    setSmsProviderForTests({ name: "panne", send: async () => { throw new Error("opérateur indisponible"); } });
    await createBooking(db, booking(), NOW);
    let clock = NOW.getTime();
    for (let i = 0; i < 5; i++) { await dispatchOutbox(db, new Date(clock)); clock += 3 * 60 * 60_000; }
    const [sms] = (await outbox()).filter((row) => row.channel === "sms");
    expect(sms).toMatchObject({ status: "failed", attempts: 5, lastError: "opérateur indisponible" });
    expect(emails).toHaveLength(1); // l’e-mail, lui, est parti au premier passage
  });

  it("envoie le rappel de la veille une seule fois, et seulement pour un RDV confirmé pris à l’avance", async () => {
    const created = await createBooking(db, booking(), NOW);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    await db.delete(messageOutbox);
    const dayBefore = doualaDateTime("2030-05-05", "12:00");
    expect(await sendDueReminders(db, NOW)).toBe(0); // trop tôt
    expect(await sendDueReminders(db, dayBefore)).toBe(1);
    expect(await sendDueReminders(db, new Date(dayBefore.getTime() + 60_000))).toBe(0); // une seule fois
    const queued = await outbox();
    expect(queued.map((row) => row.channel).sort()).toEqual(["email", "sms"]);
    expect(queued.find((row) => row.channel === "sms")!.body).toContain("rappel");
    // Un RDV en attente n’a pas de rappel.
    await createBooking(db, booking({ startsAt: at(MONDAY, "15:00") }), NOW);
    await db.delete(messageOutbox);
    expect(await sendDueReminders(db, dayBefore)).toBe(0);
    const [row] = await db.select().from(bookings).where(eq(bookings.reference, created.reference));
    expect(row.reminderSentAt).not.toBeNull();
  });

  it("vérifie l’adresse e-mail avec un lien à usage unique ; auth.me ne livre jamais l’empreinte du mot de passe", async () => {
    await db.update(users).set({ passwordHash: "scrypt$secret" }).where(eq(users.id, pro.id));
    const [proRow] = await db.select().from(users).where(eq(users.id, pro.id));
    const me = await appRouter.createCaller({ user: proRow, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] }).auth.me();
    expect(me).toMatchObject({ id: pro.id, emailVerified: false });
    expect(JSON.stringify(me)).not.toContain("scrypt");
    expect(me).not.toHaveProperty("passwordHash");

    await sendVerificationEmail(db, pro.id);
    const [mail] = await outbox();
    expect(mail).toMatchObject({ channel: "email", recipient: "cedric@kofi.test", kind: "auth.verify_email" });
    const token = tokenFrom(mail.body);
    await expect(verifyEmail(db, token)).resolves.toEqual({ verified: true });
    await expect(verifyEmail(db, token)).rejects.toMatchObject({ code: "VERIFY_TOKEN_INVALID" });
    const [verified] = await db.select().from(users).where(eq(users.id, pro.id));
    expect(verified.emailVerifiedAt).not.toBeNull();
  });
});
