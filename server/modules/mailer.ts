import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Envoi des e-mails transactionnels.
 *  EMAIL_PROVIDER  vide ou « log » = mode développement : l’e-mail n’est PAS envoyé, il est écrit
 *                  dans le dossier EMAIL_OUTBOX_DIR (défaut « outbox », ignoré par Git) et dans la console.
 *                  Refusé en production : sans prestataire réel, rien n’est envoyé.
 *  EMAIL_FROM      expéditeur affiché (défaut « KOFI <no-reply@kofi.local> »).
 *  APP_URL         adresse publique du site, utilisée dans les liens (défaut http://localhost:3000).
 * Brancher un prestataire réel = ajouter son adaptateur dans PROVIDERS.
 */
export type Email = { to: string; subject: string; text: string; html?: string };
export type MailProvider = { name: string; send(email: Email & { from: string }): Promise<void> };

const PROVIDERS: Record<string, () => MailProvider> = {};

let override: MailProvider | null | undefined;
/** Pour les tests : capture les e-mails (null = aucun envoi ; undefined = réglages normaux). */
export function setMailProviderForTests(provider: MailProvider | null | undefined) {
  override = provider;
}

export const appUrl = () => (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");

function outboxProvider(): MailProvider {
  return {
    name: "outbox",
    async send(email) {
      const dir = process.env.EMAIL_OUTBOX_DIR?.trim() || "outbox";
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeTo = email.to.replace(/[^a-z0-9@._-]/gi, "_");
      const file = join(dir, `${stamp}_${safeTo}.txt`);
      writeFileSync(file, `De : ${email.from}\nÀ : ${email.to}\nObjet : ${email.subject}\n\n${email.text}\n`, "utf8");
      console.log(`[KOFI] E-mail (mode développement, non envoyé) pour ${email.to} : « ${email.subject} » → ${file}`);
    },
  };
}

export function getMailProvider(): MailProvider | null {
  if (override !== undefined) return override;
  const name = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (!name || name === "log") {
    if (process.env.NODE_ENV === "production") return null;
    return outboxProvider();
  }
  const factory = PROVIDERS[name];
  if (!factory) console.error(`[KOFI] Prestataire e-mail inconnu : ${name}. Aucun e-mail envoyé.`);
  return factory ? factory() : null;
}

/** Envoie un e-mail ; ne lève jamais d’erreur (un échec d’envoi ne doit pas casser l’action de l’utilisateur). */
export async function sendEmail(email: Email): Promise<boolean> {
  const provider = getMailProvider();
  if (!provider) {
    console.error(`[KOFI] Aucun prestataire e-mail configuré : « ${email.subject} » non envoyé.`);
    return false;
  }
  try {
    await provider.send({ ...email, from: process.env.EMAIL_FROM?.trim() || "KOFI <no-reply@kofi.local>" });
    return true;
  } catch (error) {
    console.error(`[KOFI] Échec d’envoi de l’e-mail « ${email.subject} »`, error);
    return false;
  }
}
