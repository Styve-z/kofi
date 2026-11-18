import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { users, type User } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { verifyPassword } from "./passwordAuth";

/**
 * Double vérification (TOTP, RFC 6238) : code à 6 chiffres d’une application d’authentification
 * (Google Authenticator, Microsoft Authenticator, Authy…).
 *  - obligatoire pour les administrateurs et le super-administrateur (hors tests) ;
 *  - secret chiffré en base (AES-256-GCM, clé dérivée de TWO_FACTOR_KEY ou, à défaut, de MANUS_JWT_SECRET) ;
 *  - un code accepté ne peut pas resservir ; 8 codes de secours à usage unique.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // tolère ±30 s de décalage d’horloge
const BACKUP_CODES = 8;
export const TWO_FACTOR_ROLES = ["admin", "superadmin"] as const;

/** La double vérification est-elle exigée pour ce rôle ? (désactivable seulement hors production, pour les tests) */
export function twoFactorRequired(role: string | null | undefined) {
  if (process.env.NODE_ENV === "test" || (process.env.NODE_ENV !== "production" && process.env.REQUIRE_STAFF_2FA === "off")) return false;
  return (TWO_FACTOR_ROLES as readonly string[]).includes(role ?? "");
}

/* ---------- Base32 (format des applications d’authentification) ---------- */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buffer: Buffer) {
  let bits = 0; let value = 0; let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

/* ---------- TOTP ---------- */
export function totpAt(secretBase32: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString();
  return code.padStart(DIGITS, "0");
}
const currentStep = (now: Date) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/** Pas de temps du code s’il est valable (et plus récent que le dernier accepté), sinon null. */
export function matchTotp(secretBase32: string, code: string, now: Date, lastStep: number | null) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const candidate = step + delta;
    if (lastStep !== null && candidate <= lastStep) continue;
    const expected = Buffer.from(totpAt(secretBase32, candidate));
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return null;
}

/* ---------- Chiffrement du secret ---------- */
function key() {
  const material = process.env.TWO_FACTOR_KEY || process.env.MANUS_JWT_SECRET;
  if (!material) throw new Error("TWO_FACTOR_KEY ou MANUS_JWT_SECRET requis pour la double vérification");
  return createHash("sha256").update(`kofi-2fa:${material}`).digest();
}
export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1") throw new Error("Format de secret inconnu");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const hashBackup = (code: string) => createHash("sha256").update(`kofi-backup:${code.replace(/\W/g, "").toUpperCase()}`).digest("hex");
function newBackupCodes() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: BACKUP_CODES }, () => {
    const raw = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

/* ---------- Activation ---------- */

/** Étape 1 : génère un secret en attente et l’adresse otpauth:// à ajouter dans l’application. */
export async function startTwoFactorSetup(db: Database, user: User) {
  if (user.twoFactorEnabledAt) throw new BusinessError("TWO_FACTOR_ALREADY_ENABLED");
  const secret = base32Encode(randomBytes(20));
  await db.update(users).set({ twoFactorPendingSecret: encryptSecret(secret) }).where(eq(users.id, user.id));
  const label = encodeURIComponent(`KOFI:${user.email ?? user.name ?? `compte-${user.id}`}`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=KOFI&algorithm=SHA1&digits=6&period=30` };
}

/** Étape 2 : le premier code saisi prouve que l’application est bien réglée ; renvoie les codes de secours (une seule fois). */
export async function confirmTwoFactorSetup(db: Database, userId: number, code: string, now = new Date()) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.twoFactorPendingSecret) throw new BusinessError("TWO_FACTOR_NOT_STARTED");
  const secret = decryptSecret(user.twoFactorPendingSecret);
  const step = matchTotp(secret, code.trim(), now, null);
  if (step === null) throw new BusinessError("TWO_FACTOR_INVALID");
  const backupCodes = newBackupCodes();
  await db.update(users).set({ twoFactorSecret: user.twoFactorPendingSecret, twoFactorPendingSecret: null, twoFactorEnabledAt: now, twoFactorLastStep: step, twoFactorBackupCodes: JSON.stringify(backupCodes.map(hashBackup)) }).where(eq(users.id, userId));
  return { enabled: true as const, backupCodes };
}

/** Désactivation (mot de passe + code), impossible pour un rôle qui l’exige. */
export async function disableTwoFactor(db: Database, user: User, input: { password: string; code: string }, now = new Date()) {
  if (twoFactorRequired(user.role)) throw new BusinessError("TWO_FACTOR_REQUIRED");
  if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new BusinessError("INVALID_CREDENTIALS");
  await checkSecondFactor(db, user.id, input.code, now);
  await db.update(users).set({ twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorEnabledAt: null, twoFactorBackupCodes: null, twoFactorLastStep: null }).where(eq(users.id, user.id));
  return { enabled: false as const };
}

/* ---------- Connexion ---------- */
const failures = new Map<number, { count: number; resetAt: number }>();
export function resetTwoFactorRateLimit() { failures.clear(); }

/** Vérifie un code TOTP ou un code de secours ; consomme le code accepté. */
export async function checkSecondFactor(db: Database, userId: number, rawCode: string, now = new Date()) {
  const entry = failures.get(userId);
  if (entry && entry.resetAt > now.getTime() && entry.count >= 5) throw new BusinessError("AUTH_RATE_LIMIT");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.twoFactorSecret) throw new BusinessError("TWO_FACTOR_INVALID");
  const code = rawCode.trim();
  const step = matchTotp(decryptSecret(user.twoFactorSecret), code.replace(/\s/g, ""), now, user.twoFactorLastStep);
  if (step !== null) {
    // Condition sur l’ancien pas : deux connexions simultanées avec le même code ne passent pas toutes les deux.
    const [result] = await db.update(users).set({ twoFactorLastStep: step }).where(and(eq(users.id, userId), or(isNull(users.twoFactorLastStep), lt(users.twoFactorLastStep, step))));
    if ((result as { affectedRows?: number }).affectedRows) { failures.delete(userId); return { method: "totp" as const }; }
  }
  const hashes: string[] = JSON.parse(user.twoFactorBackupCodes ?? "[]");
  const index = hashes.indexOf(hashBackup(code));
  if (index >= 0) {
    hashes.splice(index, 1);
    await db.update(users).set({ twoFactorBackupCodes: JSON.stringify(hashes) }).where(eq(users.id, userId));
    failures.delete(userId);
    return { method: "backup" as const, remaining: hashes.length };
  }
  const current = failures.get(userId);
  if (!current || current.resetAt <= now.getTime()) failures.set(userId, { count: 1, resetAt: now.getTime() + 15 * 60_000 });
  else current.count += 1;
  throw new BusinessError("TWO_FACTOR_INVALID");
}

/* ---------- Jeton d’étape intermédiaire (mot de passe validé, code attendu) ---------- */
const CHALLENGE_TTL_MS = 5 * 60_000;

export function createLoginChallenge(userId: number, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + CHALLENGE_TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
  const sig = createHmac("sha256", key()).update(`challenge:${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function readLoginChallenge(token: string, now = Date.now()) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key()).update(`challenge:${payload}`).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: number; e: number };
    return data.e > now && Number.isInteger(data.u) ? data.u : null;
  } catch {
    return null;
  }
}