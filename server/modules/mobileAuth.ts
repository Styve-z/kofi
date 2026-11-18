import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { mobileLoginCodes, users } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import type { Database } from "../db";
import { BusinessError } from "./errors";

/**
 * Connexion de l’application mobile, sans mot de passe propre à l’app :
 *  1. l’app génère un secret (`verifier`) et envoie seulement son empreinte (`challenge`) au site ;
 *  2. l’utilisateur se connecte sur le site, qui crée un code à usage unique (5 min) et rouvre l’app ;
 *  3. l’app échange code + secret contre un jeton de session, envoyé ensuite en `Authorization: Bearer`.
 * Une autre app qui intercepterait le lien de retour n’aurait pas le secret : le code lui serait inutile.
 */

const CODE_TTL_MS = 5 * 60_000;
export const MOBILE_SESSION_MS = 30 * 86_400_000;
const B64URL = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

/**
 * Adresses de retour autorisées : le schéma de l’app (`kofi://`) et Expo Go (`exp://`, pour tester
 * sur téléphone contre le vrai serveur). Aucune page web : le code ne peut pas fuiter vers un site.
 * Même intercepté par une autre app, le code est inutilisable sans le secret gardé par l’app KOFI.
 */
export function isAllowedRedirect(url: string) {
  return /^kofi:\/\/[A-Za-z0-9/_-]*$/.test(url) || /^exp:\/\/[A-Za-z0-9.:_-]+(\/[A-Za-z0-9/_.-]*)?$/.test(url);
}

export async function createMobileLoginCode(db: Database, userId: number, challenge: string, now = new Date()) {
  if (!B64URL.test(challenge)) throw new BusinessError("MOBILE_LOGIN_INVALID");
  const code = randomBytes(32).toString("base64url");
  await db.delete(mobileLoginCodes).where(lt(mobileLoginCodes.expiresAt, now));
  await db.insert(mobileLoginCodes).values({ codeHash: sha256(code), userId, challenge, expiresAt: new Date(now.getTime() + CODE_TTL_MS) });
  return { code };
}

export async function exchangeMobileLoginCode(db: Database, input: { code: string; verifier: string }, now = new Date()) {
  if (!B64URL.test(input.verifier) || input.code.length < 20) throw new BusinessError("MOBILE_LOGIN_INVALID");
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(mobileLoginCodes).where(and(eq(mobileLoginCodes.codeHash, sha256(input.code)), isNull(mobileLoginCodes.usedAt))).limit(1).for("update");
    if (!row || row.expiresAt < now) throw new BusinessError("MOBILE_LOGIN_INVALID");
    // Le code est consommé même si le secret est faux : une tentative ratée ne peut pas être rejouée.
    await tx.update(mobileLoginCodes).set({ usedAt: now }).where(eq(mobileLoginCodes.id, row.id));
    if (sha256(input.verifier) !== row.challenge) return null;
    const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
    return user ?? null;
  });
  if (!result) throw new BusinessError("MOBILE_LOGIN_INVALID");
  if (result.status === "suspended") throw new BusinessError("ACCOUNT_SUSPENDED");
  const token = await sdk.createSessionToken(result.openId, { name: result.name ?? "", expiresInMs: MOBILE_SESSION_MS });
  return { token, expiresAt: new Date(now.getTime() + MOBILE_SESSION_MS).toISOString(), user: { id: result.id, name: result.name, role: result.role } };
}
