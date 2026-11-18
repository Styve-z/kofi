/** Mot de passe oublié : lien unique, expiration, déconnexion des sessions (base réelle). */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { passwordResetTokens, users } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { sdk } from "../_core/sdk";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { setMailProviderForTests, type Email } from "./mailer";
import { hashPassword, loginWithPassword, resetAuthRateLimit } from "./passwordAuth";
import { requestPasswordReset, resetPassword, resetPasswordResetRateLimit, RESET_TOKEN_TTL_MS } from "./passwordReset";

describe.skipIf(!url)("mot de passe oublié (base réelle)", () => {
  let db: Database;
  let sent: Email[] = [];
  const caller = () => appRouter.createCaller({ user: null, req: { ip: "10.0.0.1" } as TrpcContext["req"], res: { cookie: () => undefined } as unknown as TrpcContext["res"] });
  const tokenFrom = (email: Email) => /token=([A-Za-z0-9_-]{43})/.exec(email.text)?.[1] ?? "";

  beforeAll(async () => {
    db = await openTestDb(); process.env.DATABASE_URL = url;
    process.env.MANUS_JWT_SECRET ||= "test-only-secret-for-reset-tests";
    process.env.MANUS_PROJECT_ID ||= "kofi-test";
  }, 60_000);
  afterAll(async () => { setMailProviderForTests(undefined); await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    resetAuthRateLimit(); resetPasswordResetRateLimit();
    sent = [];
    setMailProviderForTests({ name: "memoire", send: async (email) => { sent.push(email); } });
    const hash = await hashPassword("ancien-mot-de-passe");
    await db.insert(users).values([
      { openId: "c", name: "Awa", email: "awa@kofi.test", passwordHash: hash, loginMethod: "password", role: "user" },
      { openId: "sa", name: "Boss", email: "boss@kofi.test", passwordHash: hash, loginMethod: "password", role: "superadmin" },
    ]);
  });
  afterEach(() => setMailProviderForTests(undefined));

  it("envoie un lien et répond pareil pour un e-mail inconnu", async () => {
    await expect(caller().auth.requestPasswordReset({ email: "Awa@Kofi.test" })).resolves.toEqual({ sent: true });
    await expect(caller().auth.requestPasswordReset({ email: "personne@kofi.test" })).resolves.toEqual({ sent: true });
    await expect(caller().auth.requestPasswordReset({ email: "boss@kofi.test" })).resolves.toEqual({ sent: true });
    // Un seul e-mail : ni compte inconnu, ni super-admin (réinitialisation par script uniquement).
    expect(sent.map((email) => email.to)).toEqual(["awa@kofi.test"]);
    const token = tokenFrom(sent[0]);
    expect(token).toHaveLength(43);
    // Le jeton en clair n’est jamais stocké.
    const [row] = await db.select().from(passwordResetTokens);
    expect(row.tokenHash).not.toContain(token);
  });

  it("change le mot de passe une seule fois et déconnecte les anciennes sessions", async () => {
    const [awa] = await db.select().from(users).where(eq(users.email, "awa@kofi.test"));
    const oldSession = await sdk.createSessionToken(awa.openId, { name: "Awa" });
    const req = (token: string) => ({ headers: { cookie: `app_session_id=${token}`, authorization: `Bearer ${token}` }, path: "/api/trpc" }) as unknown as Parameters<typeof sdk.authenticateRequest>[0];
    await expect(sdk.authenticateRequest(req(oldSession))).resolves.toMatchObject({ id: awa.id });

    await requestPasswordReset(db, { email: "awa@kofi.test" });
    const token = tokenFrom(sent[0]);
    await expect(caller().auth.checkResetToken({ token })).resolves.toEqual({ valid: true });
    await expect(caller().auth.resetPassword({ token, password: "court" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await new Promise((resolve) => setTimeout(resolve, 1100)); // la session ancienne doit dater d’une seconde antérieure
    await expect(caller().auth.resetPassword({ token, password: "nouveau-mot-de-passe" })).resolves.toEqual({ reset: true });
    expect(sent[1].subject).toContain("modifié");
    // Lien à usage unique.
    await expect(caller().auth.resetPassword({ token, password: "encore-un-autre" })).rejects.toMatchObject({ message: "RESET_TOKEN_INVALID" });
    await expect(caller().auth.checkResetToken({ token })).resolves.toEqual({ valid: false });
    // Ancien mot de passe refusé, nouveau accepté ; l’ancienne session est révoquée, la nouvelle fonctionne.
    await expect(loginWithPassword(db, { email: "awa@kofi.test", password: "ancien-mot-de-passe" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const fresh = await loginWithPassword(db, { email: "awa@kofi.test", password: "nouveau-mot-de-passe" });
    await expect(sdk.authenticateRequest(req(oldSession))).rejects.toThrow();
    await expect(sdk.authenticateRequest(req(fresh.token))).resolves.toMatchObject({ id: awa.id });
  });

  it("refuse un lien expiré, inventé ou remplacé par une nouvelle demande", async () => {
    const now = new Date();
    await requestPasswordReset(db, { email: "awa@kofi.test" }, now);
    const first = tokenFrom(sent[0]);
    await expect(resetPassword(db, { token: first, password: "nouveau-mot-de-passe" }, new Date(now.getTime() + RESET_TOKEN_TTL_MS + 1000))).rejects.toMatchObject({ code: "RESET_TOKEN_INVALID" });
    await requestPasswordReset(db, { email: "awa@kofi.test" }, now);
    const second = tokenFrom(sent[1]);
    await expect(resetPassword(db, { token: first, password: "nouveau-mot-de-passe" }, now)).rejects.toMatchObject({ code: "RESET_TOKEN_INVALID" });
    await expect(resetPassword(db, { token: "x".repeat(43), password: "nouveau-mot-de-passe" }, now)).rejects.toMatchObject({ code: "RESET_TOKEN_INVALID" });
    await expect(resetPassword(db, { token: second, password: "nouveau-mot-de-passe" }, now)).resolves.toEqual({ reset: true });
  });

  it("limite les demandes répétées", async () => {
    for (let i = 0; i < 5; i++) await requestPasswordReset(db, { email: "awa@kofi.test" });
    expect(sent).toHaveLength(3);
  });
});
