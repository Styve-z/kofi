import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { emailVerificationTokens, users, type User } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { appUrl } from "./mailer";
import { enqueueEmail } from "./messaging";

/**
 * Vérification de l’adresse e-mail : un lien est envoyé à l’inscription (et sur demande).
 * Tant qu’elle n’est pas vérifiée, aucun e-mail de notification ne part vers cette adresse :
 * on n’écrit pas à quelqu’un qui n’a pas prouvé qu’elle est la sienne.
 */
export const VERIFY_TOKEN_TTL_MS = 48 * 60 * 60_000;
const RESEND_WINDOW_MS = 60 * 60_000;
const MAX_RESENDS = 3;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const resends = new Map<number, number[]>();
export function resetVerificationRateLimit() { resends.clear(); }

/** Écrit l’e-mail de vérification dans la file d’envoi. */
export async function sendVerificationEmail(db: Database, userId: number, now = new Date()) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email || user.emailVerifiedAt) return { sent: false as const };
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.update(emailVerificationTokens).set({ usedAt: now }).where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));
    await tx.insert(emailVerificationTokens).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS) });
    await enqueueEmail(tx, {
      to: user.email!,
      subject: "Confirmez votre adresse e-mail KOFI",
      text: [`Bonjour ${user.name ?? ""},`.trim(), "", "Bienvenue sur KOFI ! Confirmez votre adresse e-mail pour recevoir vos confirmations et rappels de rendez-vous :", `${appUrl()}/verifier-email?token=${token}`, "", "Ce lien est valable 48 heures. Si vous n’avez pas créé de compte KOFI, ignorez cet e-mail.", "", "L’équipe KOFI"].join("\n"),
      kind: "auth.verify_email",
    });
  });
  return { sent: true as const };
}

/** Renvoi demandé par l’utilisateur connecté (3 par heure au plus). */
export async function resendVerificationEmail(db: Database, user: Pick<User, "id" | "emailVerifiedAt">, now = new Date()) {
  if (user.emailVerifiedAt) return { sent: false as const, alreadyVerified: true as const };
  const recent = (resends.get(user.id) ?? []).filter((at) => at > now.getTime() - RESEND_WINDOW_MS);
  if (recent.length >= MAX_RESENDS) throw new BusinessError("VERIFY_RATE_LIMIT");
  recent.push(now.getTime());
  resends.set(user.id, recent);
  return { ...(await sendVerificationEmail(db, user.id, now)), alreadyVerified: false as const };
}

export async function verifyEmail(db: Database, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BusinessError("VERIFY_TOKEN_INVALID");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.tokenHash, hashToken(token)), isNull(emailVerificationTokens.usedAt), gt(emailVerificationTokens.expiresAt, now))).limit(1).for("update");
    if (!row) throw new BusinessError("VERIFY_TOKEN_INVALID");
    await tx.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, row.id));
    await tx.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
    return { verified: true as const };
  });
}

/** Ce que le navigateur reçoit du compte connecté : jamais l’empreinte du mot de passe ni les champs internes. */
export function publicUser(user: User | null) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, loginMethod: user.loginMethod, emailVerified: Boolean(user.emailVerifiedAt), createdAt: user.createdAt, lastSignedIn: user.lastSignedIn };
}
