/** Connexion de l’application mobile (échange code + secret), contre une vraie base. */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { isAllowedRedirect } from "./mobileAuth";

const pair = () => { const verifier = randomBytes(32).toString("base64url"); return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }; };

describe("isAllowedRedirect", () => {
  it("n’accepte que le schéma de l’app et Expo Go, jamais une page web", () => {
    expect(isAllowedRedirect("kofi://auth")).toBe(true);
    expect(isAllowedRedirect("https://pirate.example/auth")).toBe(false);
    expect(isAllowedRedirect("kofi://auth?x=<script>")).toBe(false);
    expect(isAllowedRedirect("exp://192.168.1.10:8081/--/auth")).toBe(true);
    expect(isAllowedRedirect("javascript:alert(1)")).toBe(false);
  });
});

describe.skipIf(!url)("connexion de l’application mobile (base réelle)", () => {
  let db: Database;
  let user: User;
  const caller = (who: User | null, headers: Record<string, string> = {}) => appRouter.createCaller({ user: who, req: { headers } as unknown as TrpcContext["req"], res: {} as TrpcContext["res"] });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MANUS_JWT_SECRET ||= "secret-de-test-mobile-0123456789";
    process.env.MANUS_PROJECT_ID ||= "kofi-test";
    db = await openTestDb();
  }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    await db.insert(users).values({ openId: "mobile-user", name: "Amina Mobile", role: "user" });
    [user] = await db.select().from(users).where(eq(users.openId, "mobile-user"));
  });

  it("échange le code contre un jeton de session valable, une seule fois", async () => {
    const { verifier, challenge } = pair();
    const { redirectUrl } = await caller(user).mobile.createLoginCode({ challenge, redirect: "kofi://auth" });
    const code = new URL(redirectUrl).searchParams.get("code")!;
    expect(redirectUrl.startsWith("kofi://auth?code=")).toBe(true);
    const result = await caller(null).mobile.exchange({ code, verifier });
    expect(result.user).toMatchObject({ id: user.id, name: "Amina Mobile" });
    // Le jeton ouvre une session côté serveur (en-tête Authorization).
    const { sdk } = await import("../_core/sdk");
    await expect(sdk.verifySession(result.token)).resolves.toMatchObject({ openId: "mobile-user" });
    await expect(caller(null).mobile.exchange({ code, verifier })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "MOBILE_LOGIN_INVALID" });
  });

  it("refuse un mauvais secret, et le code est alors grillé", async () => {
    const { verifier, challenge } = pair();
    const { redirectUrl } = await caller(user).mobile.createLoginCode({ challenge, redirect: "kofi://auth" });
    const code = new URL(redirectUrl).searchParams.get("code")!;
    await expect(caller(null).mobile.exchange({ code, verifier: pair().verifier })).rejects.toMatchObject({ message: "MOBILE_LOGIN_INVALID" });
    await expect(caller(null).mobile.exchange({ code, verifier })).rejects.toMatchObject({ message: "MOBILE_LOGIN_INVALID" });
  });

  it("refuse un code expiré, une redirection étrangère et un compte suspendu", async () => {
    const { exchangeMobileLoginCode, createMobileLoginCode } = await import("./mobileAuth");
    const first = pair();
    const { code } = await createMobileLoginCode(db, user.id, first.challenge, new Date(Date.now() - 6 * 60_000));
    await expect(exchangeMobileLoginCode(db, { code, verifier: first.verifier })).rejects.toThrow("MOBILE_LOGIN_INVALID");
    await expect(caller(user).mobile.createLoginCode({ challenge: pair().challenge, redirect: "https://pirate.example/" })).rejects.toMatchObject({ message: "MOBILE_LOGIN_INVALID" });
    await expect(caller(null).mobile.createLoginCode({ challenge: pair().challenge, redirect: "kofi://auth" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const second = pair();
    const fresh = await createMobileLoginCode(db, user.id, second.challenge);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, user.id));
    await expect(exchangeMobileLoginCode(db, { code: fresh.code, verifier: second.verifier })).rejects.toThrow("ACCOUNT_SUSPENDED");
  });
});
