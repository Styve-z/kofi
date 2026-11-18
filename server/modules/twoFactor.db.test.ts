/** Double vérification (TOTP) : algorithme, activation, connexion en deux étapes (base réelle). */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { hashPassword, resetAuthRateLimit } from "./passwordAuth";
import { base32Decode, base32Encode, checkSecondFactor, confirmTwoFactorSetup, decryptSecret, encryptSecret, matchTotp, resetTwoFactorRateLimit, startTwoFactorSetup, totpAt, twoFactorRequired } from "./twoFactor";

describe("TOTP (RFC 6238)", () => {
  beforeAll(() => { process.env.MANUS_JWT_SECRET ||= "test-only-secret-for-2fa"; });
  it("reproduit le vecteur de test officiel", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });
  it("tolère ±30 s, refuse un code rejoué ou mal formé", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = new Date(1111111109 * 1000);
    const step = Math.floor(1111111109 / 30);
    expect(matchTotp(secret, totpAt(secret, step - 1), now, null)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, step), now, step)).toBeNull(); // déjà utilisé
    expect(matchTotp(secret, totpAt(secret, step - 3), now, null)).toBeNull(); // trop ancien
    expect(matchTotp(secret, "12345", now, null)).toBeNull();
  });
  it("chiffre le secret en base", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("n’est désactivable qu’en dehors de la production", () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production"; process.env.REQUIRE_STAFF_2FA = "off";
    expect(twoFactorRequired("admin")).toBe(true);
    expect(twoFactorRequired("user")).toBe(false);
    process.env.NODE_ENV = saved; delete process.env.REQUIRE_STAFF_2FA;
  });
});

describe.skipIf(!url)("double vérification (base réelle)", () => {
  let db: Database;
  const cookies: string[] = [];
  const ctx = () => ({ user: null, req: { ip: "10.0.0.9" } as TrpcContext["req"], res: { cookie: (name: string) => { cookies.push(name); } } as unknown as TrpcContext["res"] });
  beforeAll(async () => {
    process.env.DATABASE_URL = url; db = await openTestDb();
    process.env.MANUS_JWT_SECRET ||= "test-only-secret-for-2fa"; process.env.MANUS_PROJECT_ID ||= "kofi-test";
  }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db); resetAuthRateLimit(); resetTwoFactorRateLimit(); cookies.length = 0;
    await db.insert(users).values({ openId: "ad", name: "Admin", email: "admin@kofi.test", role: "admin", passwordHash: await hashPassword("mot-de-passe-admin"), loginMethod: "password" });
  });

  it("active la double vérification puis exige le code à la connexion", async () => {
    const [admin] = await db.select().from(users);
    const { secret, otpauthUrl } = await startTwoFactorSetup(db, admin);
    expect(otpauthUrl).toContain("issuer=KOFI");
    const now = new Date();
    const step = Math.floor(now.getTime() / 30_000);
    await expect(confirmTwoFactorSetup(db, admin.id, "000000", now)).rejects.toMatchObject({ code: "TWO_FACTOR_INVALID" });
    const { backupCodes } = await confirmTwoFactorSetup(db, admin.id, totpAt(secret, step), now);
    expect(backupCodes).toHaveLength(8);
    const [stored] = await db.select().from(users);
    expect(stored.twoFactorSecret).not.toContain(secret);

    // Étape 1 : le bon mot de passe ne suffit plus, aucun cookie de session.
    const first = await appRouter.createCaller(ctx()).auth.login({ email: "admin@kofi.test", password: "mot-de-passe-admin" });
    expect(first).toMatchObject({ success: false, twoFactor: true });
    expect(cookies).toHaveLength(0);
    // Étape 2 : mauvais code refusé ; code de secours accepté une seule fois.
    await expect(appRouter.createCaller(ctx()).auth.loginTwoFactor({ challenge: first.challenge!, code: "123456" })).rejects.toMatchObject({ message: "TWO_FACTOR_INVALID" });
    await expect(appRouter.createCaller(ctx()).auth.loginTwoFactor({ challenge: first.challenge!, code: backupCodes[0] })).resolves.toMatchObject({ success: true });
    expect(cookies).toHaveLength(1);
    await expect(checkSecondFactor(db, admin.id, backupCodes[0])).rejects.toMatchObject({ code: "TWO_FACTOR_INVALID" });
    // Un jeton d’étape trafiqué est refusé.
    await expect(appRouter.createCaller(ctx()).auth.loginTwoFactor({ challenge: `${first.challenge}x`, code: backupCodes[1] })).rejects.toMatchObject({ message: "TWO_FACTOR_EXPIRED" });
  });

  it("bloque après 5 codes faux", async () => {
    const [admin] = await db.select().from(users);
    const { secret } = await startTwoFactorSetup(db, admin);
    const now = new Date();
    await confirmTwoFactorSetup(db, admin.id, totpAt(secret, Math.floor(now.getTime() / 30_000)), now);
    for (let i = 0; i < 5; i++) await expect(checkSecondFactor(db, admin.id, "999999")).rejects.toMatchObject({ code: "TWO_FACTOR_INVALID" });
    await expect(checkSecondFactor(db, admin.id, "999999")).rejects.toMatchObject({ code: "AUTH_RATE_LIMIT" });
    const [row] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row.twoFactorEnabledAt).not.toBeNull();
  });
});
