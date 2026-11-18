/** Droits sur les données : export et suppression du compte (base réelle). */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, favorites, professionalProfiles, users, type User } from "../../drizzle/schema";
import type { Database } from "../db";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { deleteMyAccount, exportMyData } from "./accountData";
import { cancelBooking, createBooking } from "./booking";
import { hashPassword, loginWithPassword, resetAuthRateLimit } from "./passwordAuth";

describe.skipIf(!url)("mes données (base réelle)", () => {
  let db: Database;
  let client: User;
  beforeAll(async () => {
    process.env.DATABASE_URL = url; db = await openTestDb();
    process.env.MANUS_JWT_SECRET ||= "test-only-secret-for-account-data"; process.env.MANUS_PROJECT_ID ||= "kofi-test";
  }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db); resetAuthRateLimit();
    await db.insert(users).values([
      { openId: "c1", name: "Amina Njoya", email: "amina@kofi.test", role: "user", passwordHash: await hashPassword("mot-de-passe-amina"), loginMethod: "password" },
      { openId: "a1", name: "Admin", email: "admin@kofi.test", role: "admin" },
    ]);
    [client] = await db.select().from(users).where(eq(users.openId, "c1"));
  });
  const book = () => createBooking(db, { customerUserId: client.id, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 75, timezone: "Africa/Douala", mode: "salon", customerName: "Amina Njoya", customerPhone: "690000001", serviceIds: ["cedric-duo"], totalXaf: 10_000, notes: "Allergie au henné" }, NOW);

  it("exporte toutes les données du compte, sans secret", async () => {
    await book();
    const data = await exportMyData(db, client.id);
    expect(data.account).toMatchObject({ email: "amina@kofi.test", name: "Amina Njoya" });
    expect(data.bookings).toHaveLength(1);
    expect(data.bookings[0]).toMatchObject({ notes: "Allergie au henné" });
    expect(data.bookings[0].customerPhone).toContain("690000001");
    expect(JSON.stringify(data)).not.toContain("scrypt");
  });

  it("supprime le compte : refus si RDV à venir, puis anonymisation complète", async () => {
    const created = await book();
    const [pro] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.slug, "cedric-mbarga"));
    await db.insert(favorites).values({ userId: client.id, professionalId: pro.id });
    await expect(deleteMyAccount(db, client, { password: "mot-de-passe-amina", confirm: "SUPPRIMER" }, NOW)).rejects.toMatchObject({ code: "ACCOUNT_HAS_UPCOMING_BOOKINGS" });
    await cancelBooking(db, created.reference, client.id, NOW);
    await expect(deleteMyAccount(db, client, { password: "mauvais", confirm: "SUPPRIMER" }, NOW)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(deleteMyAccount(db, client, { password: "mot-de-passe-amina", confirm: "oui" }, NOW)).rejects.toMatchObject({ code: "DELETE_CONFIRM_REQUIRED" });
    await expect(deleteMyAccount(db, client, { password: "mot-de-passe-amina", confirm: "supprimer" }, NOW)).resolves.toEqual({ deleted: true });

    const [gone] = await db.select().from(users).where(eq(users.id, client.id));
    expect(gone).toMatchObject({ name: "Compte supprimé", email: null, passwordHash: null, status: "suspended" });
    const [row] = await db.select().from(bookings).where(eq(bookings.reference, created.reference));
    expect(row).toMatchObject({ customerName: "Client supprimé", customerPhone: "supprimé", notes: null });
    expect(await db.select().from(favorites)).toHaveLength(0);
    await expect(loginWithPassword(db, { email: "amina@kofi.test", password: "mot-de-passe-amina" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    // L’équipe KOFI ne se supprime pas elle-même.
    const [admin] = await db.select().from(users).where(eq(users.openId, "a1"));
    await expect(deleteMyAccount(db, admin, { password: "", confirm: "SUPPRIMER" }, NOW)).rejects.toMatchObject({ code: "ACCOUNT_PROTECTED" });
  });
});
