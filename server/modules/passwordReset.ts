import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { passwordResetTokens, users } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { appUrl, sendEmail } from "./mailer";
import { hashPassword, normalizeEmail, PASSWORD_MAX, PASSWORD_MIN } from "./passwordAuth";

/**
 * « Mot de passe oublié » :
 *  - la demande répond toujours pareil, que l’e-mail existe ou non (on ne révèle pas les comptes) ;
 *  - le lien contient un jeton aléatoire de 256 bits ; seule son empreinte SHA-256 est en base ;
 *  - il expire après 1 h, ne sert qu’une fois, et une nouvelle demande annule les précédents ;
 *  - la réinitialisation déconnecte toutes les sessions ouvertes avec l’ancien mot de passe ;
 *  - le super-administrateur ne peut pas réinitialiser par e-mail (scripts/set-password.ts seulement).
 */

export const RESET_TOKEN_TTL_MS = 60 * 60_000;
const REQUEST_WINDOW_MS = 60 * 60_000;
const MAX_REQUESTS_PER_EMAIL = 3;
const MAX_REQUESTS_PER_IP = 10;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const requests = new Map<string, number[]>();
function allowRequest(key: string, max: number, now: number) {
  const recent = (requests.get(key) ?? []).filter((at) => at > now - REQUEST_WINDOW_MS);
  if (recent.length >= max) { requests.set(key, recent); return false; }
  recent.push(now);
  requests.set(key, recent);
  if (requests.size > 10_000) for (const [k, list] of requests) if (!list.some((at) => at > now - REQUEST_WINDOW_MS)) requests.delete(k);
  return true;
}

/** Pour les tests. */
export function resetPasswordResetRateLimit() {
  requests.clear();
}

export async function requestPasswordReset(db: Database, input: { email: string; ip?: string }, now = new Date()) {
  const email = normalizeEmail(input.email);
  if (input.ip && !allowRequest(`ip:${input.ip}`, MAX_REQUESTS_PER_IP, now.getTime())) throw new BusinessError("RESET_RATE_LIMIT");
  // Au-delà de la limite par e-mail, on répond « envoyé » sans rien envoyer (pas d’information sur le compte).
  if (!allowRequest(`email:${email}`, MAX_REQUESTS_PER_EMAIL, now.getTime())) return { sent: true as const };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.passwordHash || user.status === "suspended" || user.role === "superadmin") return { sent: true as const };

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.update(passwordResetTokens).set({ usedAt: now }).where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS) });
  });

  const link = `${appUrl()}/mot-de-passe/nouveau?token=${token}`;
  await sendEmail({
    to: email,
    subject: "Réinitialisez votre mot de passe KOFI",
    text: [
      `Bonjour ${user.name ?? ""},`.trim(),
      "",
      "Vous avez demandé à changer votre mot de passe KOFI. Ouvrez ce lien pour en choisir un nouveau :",
      link,
      "",
      "Ce lien est valable 1 heure et ne fonctionne qu’une seule fois.",
      "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.",
      "",
      "L’équipe KOFI",
    ].join("\n"),
  });
  return { sent: true as const };
}

async function findValidToken(db: Database, token: string, now: Date) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db.select().from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now))).limit(1);
  return row ?? null;
}

/** Vérifie un lien avant d’afficher le formulaire (sans le consommer). */
export async function checkResetToken(db: Database, token: string, now = new Date()) {
  return { valid: Boolean(await findValidToken(db, token, now)) };
}

export async function resetPassword(db: Database, input: { token: string; password: string }, now = new Date()) {
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) throw new BusinessError("PASSWORD_WEAK");
  const passwordHash = await hashPassword(input.password);
  const result = await db.transaction(async (tx) => {
    const row = await findValidToken(tx as unknown as Database, input.token, now);
    if (!row) throw new BusinessError("RESET_TOKEN_INVALID");
    // Verrou : deux envois simultanés du même lien ne peuvent pas tous deux réussir.
    const [locked] = await tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, row.id)).limit(1).for("update");
    if (!locked || locked.usedAt) throw new BusinessError("RESET_TOKEN_INVALID");
    const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.status === "suspended" || user.role === "superadmin") throw new BusinessError("RESET_TOKEN_INVALID");
    // Arrondi à la seconde : les sessions ouvertes avant sont refusées, celles ouvertes après acceptées.
    const cutoff = new Date(Math.floor(now.getTime() / 1000) * 1000);
    await tx.update(users).set({ passwordHash, loginMethod: user.loginMethod ?? "password", sessionsValidAfter: cutoff }).where(eq(users.id, user.id));
    await tx.update(passwordResetTokens).set({ usedAt: now }).where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    return { email: user.email, name: user.name };
  });
  // Prévenir le titulaire : s’il n’a rien demandé, il sait que son compte est visé.
  if (result.email) await sendEmail({
    to: result.email,
    subject: "Votre mot de passe KOFI a été modifié",
    text: [`Bonjour ${result.name ?? ""},`.trim(), "", "Le mot de passe de votre compte KOFI vient d’être changé. Toutes vos sessions ont été déconnectées.", "Si vous n’êtes pas à l’origine de ce changement, contactez immédiatement le support KOFI.", "", "L’équipe KOFI"].join("\n"),
  });
  return { reset: true as const };
}
