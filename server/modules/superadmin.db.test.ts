/** Super-administrateur : accès à /superadmin et protection des comptes (base réelle). */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { loginWithPassword, resetAuthRateLimit, SUPERADMIN_SESSION_MS } from "./passwordAuth";

describe.skipIf(!url)("super-administrateur (base réelle)", () => {
  let db: Database;
  const u: Record<string, User> = {};

  beforeAll(async () => {
    db = await openTestDb(); process.env.DATABASE_URL = url;
    // Valeurs de test pour signer les sessions (lues au moment de l’usage).
    process.env.MANUS_JWT_SECRET ||= "test-only-secret-for-superadmin-tests";
    process.env.MANUS_PROJECT_ID ||= "kofi-test";
  }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    resetAuthRateLimit();
    await db.insert(users).values([
      { openId: "sa", name: "Super", role: "superadmin" }, { openId: "ad", name: "Admin", role: "admin" }, { openId: "ad2", name: "Admin 2", role: "admin" },
      { openId: "mod", name: "Modo", role: "moderator" }, { openId: "cl", name: "Client", role: "user" },
    ]);
    for (const user of await db.select().from(users)) u[user.openId] = user;
  });

  const caller = (user: User | null) => appRouter.createCaller({ user, req: { ip: "127.0.0.1" } as TrpcContext["req"], res: { cookie: () => undefined } as unknown as TrpcContext["res"] });

  it("refuse l’espace super-admin à tout autre compte", async () => {
    for (const key of ["ad", "mod", "cl"]) await expect(caller(u[key]).superadmin.team()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).superadmin.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, u.sa.id));
    await expect(caller({ ...u.sa, status: "suspended" }).superadmin.team()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("le super-admin gère l’équipe ; un admin ne touche ni aux admins ni au super-admin", async () => {
    const sa = caller(u.sa);
    const admin = caller(u.ad);
    expect((await sa.superadmin.team()).map((member) => member.role).sort()).toEqual(["admin", "admin", "moderator", "superadmin"]);
    // Un admin ne nomme pas d’admin et ne modifie ni un autre admin ni le super-admin.
    await expect(admin.admin.users.setRole({ userId: u.cl.id, role: "admin" })).rejects.toMatchObject({ message: "ROLE_NOT_ALLOWED" });
    await expect(admin.admin.users.setRole({ userId: u.ad2.id, role: "user" })).rejects.toMatchObject({ message: "ACCOUNT_PROTECTED" });
    await expect(admin.admin.users.setStatus({ userId: u.sa.id, status: "suspended", reason: "test" })).rejects.toMatchObject({ message: "ACCOUNT_PROTECTED" });
    await expect(admin.admin.users.setRole({ userId: u.cl.id, role: "moderator" })).resolves.toMatchObject({ role: "moderator" });
    // Le rôle « superadmin » ne s’attribue jamais depuis l’API.
    await expect(sa.superadmin.setRole({ userId: u.cl.id, role: "superadmin" as "admin" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Le super-admin nomme, retire et suspend les administrateurs.
    await expect(sa.superadmin.setRole({ userId: u.ad2.id, role: "user" })).resolves.toMatchObject({ role: "user" });
    await expect(sa.superadmin.setStatus({ userId: u.ad.id, status: "suspended", reason: "Départ" })).resolves.toMatchObject({ status: "suspended" });
    await expect(sa.superadmin.createAccount({ name: "Nouvel admin", email: "Nouvel@Kofi.test", password: "trop-court", role: "admin" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(sa.superadmin.createAccount({ name: "Nouvel admin", email: "Nouvel@Kofi.test", password: "un-mot-de-passe-long", role: "admin" })).resolves.toMatchObject({ role: "admin" });
    await expect(sa.superadmin.createAccount({ name: "Doublon", email: "nouvel@kofi.test", password: "un-mot-de-passe-long", role: "support" })).rejects.toMatchObject({ message: "EMAIL_TAKEN" });
    const login = await loginWithPassword(db, { email: "nouvel@kofi.test", password: "un-mot-de-passe-long" });
    expect(login.role).toBe("admin");
    expect((await sa.superadmin.audit()).map((entry) => entry.action)).toContain("Compte d’équipe créé");
  });

  it("la connexion du super-admin mène à /superadmin avec une session courte", async () => {
    const { hashPassword } = await import("./passwordAuth");
    await db.update(users).set({ email: "boss@kofi.test", passwordHash: await hashPassword("mot-de-passe-du-boss") }).where(eq(users.id, u.sa.id));
    await db.update(users).set({ email: "admin@kofi.test", passwordHash: await hashPassword("mot-de-passe-admin") }).where(eq(users.id, u.ad.id));
    const cookies: { maxAge?: number }[] = [];
    const ctx = { user: null, req: { ip: "127.0.0.1" } as TrpcContext["req"], res: { cookie: (_name: string, _value: string, options: { maxAge?: number }) => { cookies.push(options); } } as unknown as TrpcContext["res"] };
    await expect(appRouter.createCaller(ctx).auth.login({ email: "boss@kofi.test", password: "mot-de-passe-du-boss" })).resolves.toMatchObject({ home: "/superadmin" });
    expect(cookies[0].maxAge).toBe(SUPERADMIN_SESSION_MS);
    await expect(appRouter.createCaller(ctx).auth.login({ email: "admin@kofi.test", password: "mot-de-passe-admin" })).resolves.toMatchObject({ home: null });
  });
});
