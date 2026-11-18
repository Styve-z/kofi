import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { ONE_YEAR_MS } from "@shared/const";
import { sdk } from "../_core/sdk";
import type { Database } from "../db";
import { BusinessError } from "./errors";

/**
 * Connexion e-mail + mot de passe, propre à KOFI (sans fournisseur externe).
 *  - le mot de passe n’est jamais stocké : seule une empreinte scrypt salée l’est (colonne users.passwordHash) ;
 *  - une fois connecté, la session est le même cookie JWT que la connexion OAuth (aucun autre code à changer) ;
 *  - les erreurs ne disent pas si l’e-mail existe (« identifiants invalides »), et les essais ratés sont limités.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))));
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Format stocké : scrypt$N$r$p$sel$empreinte (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Empreinte factice : un e-mail inconnu coûte le même temps qu’un mauvais mot de passe. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomUUID()));

/* ---------- Limitation des essais (mémoire du serveur, suffisant pour une instance unique) ---------- */

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;
const failures = new Map<string, { count: number; resetAt: number }>();

function assertNotLimited(keys: string[], now: number) {
  for (const key of keys) {
    const entry = failures.get(key);
    if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) throw new BusinessError("AUTH_RATE_LIMIT");
  }
}

function recordFailure(keys: string[], now: number) {
  for (const key of keys) {
    const entry = failures.get(key);
    if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    else entry.count += 1;
  }
  if (failures.size > 10_000) for (const [key, entry] of failures) if (entry.resetAt <= now) failures.delete(key);
}

function clearFailures(keys: string[]) {
  for (const key of keys) failures.delete(key);
}

/** Pour les tests. */
export function resetAuthRateLimit() {
  failures.clear();
}

/* ---------- Inscription / connexion ---------- */

/** Session du super-administrateur : 12 h seulement (reconnexion obligatoire chaque jour). */
export const SUPERADMIN_SESSION_MS = 12 * 60 * 60_000;

export const sessionDurationFor = (role: string | null | undefined) => (role === "superadmin" ? SUPERADMIN_SESSION_MS : ONE_YEAR_MS);

async function sessionFor(user: { openId: string; name: string | null; role?: string | null }) {
  return sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: sessionDurationFor(user.role) });
}

export async function registerWithPassword(db: Database, input: { name: string; email: string; password: string }) {
  const email = normalizeEmail(input.email);
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) throw new BusinessError("PASSWORD_WEAK");

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new BusinessError("EMAIL_TAKEN");

  const openId = `pwd_${randomUUID().replace(/-/g, "")}`;
  const name = input.name.trim();
  try {
    await db.insert(users).values({ openId, name, email, passwordHash: await hashPassword(input.password), loginMethod: "password", lastSignedIn: new Date() });
  } catch (error) {
    // Deux inscriptions simultanées avec le même e-mail : l’index unique tranche.
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY" || String((error as { cause?: { code?: string } })?.cause?.code) === "ER_DUP_ENTRY") throw new BusinessError("EMAIL_TAKEN");
    throw error;
  }
  const [created] = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
  return { token: await sessionFor({ openId, name }), userId: created.id };
}

export async function loginWithPassword(db: Database, input: { email: string; password: string; ip?: string }, now = Date.now()) {
  const email = normalizeEmail(input.email);
  const keys = [`email:${email}`, ...(input.ip ? [`ip:${input.ip}`] : [])];
  assertNotLimited(keys, now);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, await getDummyHash()), false);
  if (!user || !ok) {
    recordFailure(keys, now);
    throw new BusinessError("INVALID_CREDENTIALS");
  }
  if (user.status === "suspended") throw new BusinessError("ACCOUNT_SUSPENDED");

  clearFailures(keys);
  // Double vérification activée : pas de session avant le code (voir openSessionAfterSecondFactor).
  if (user.twoFactorEnabledAt) return { token: null, twoFactorUserId: user.id, role: user.role, maxAge: sessionDurationFor(user.role) };
  await db.update(users).set({ lastSignedIn: new Date(now) }).where(eq(users.id, user.id));
  return { token: await sessionFor(user), twoFactorUserId: null, role: user.role, maxAge: sessionDurationFor(user.role) };
}

/** Deuxième étape de connexion : le code a été vérifié, on ouvre la session. */
export async function openSessionAfterSecondFactor(db: Database, userId: number, now = Date.now()) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status === "suspended") throw new BusinessError("INVALID_CREDENTIALS");
  await db.update(users).set({ lastSignedIn: new Date(now) }).where(eq(users.id, user.id));
  return { token: await sessionFor(user), role: user.role, maxAge: sessionDurationFor(user.role) };
}
