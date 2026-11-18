import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Envoi des SMS.
 *  SMS_PROVIDER  vide ou « log » = mode développement : le SMS n’est PAS envoyé, il est écrit dans
 *                le dossier EMAIL_OUTBOX_DIR (défaut « outbox », ignoré par Git) et dans la console.
 *                Refusé en production : sans prestataire réel, rien n’est envoyé.
 *  SMS_SENDER    nom d’expéditeur affiché (défaut « KOFI »), selon ce que l’opérateur autorise.
 * Brancher un opérateur réel = ajouter son adaptateur dans PROVIDERS.
 */
export type Sms = { to: string; text: string };
export type SmsProvider = { name: string; send(sms: Sms & { sender: string }): Promise<void> };

const PROVIDERS: Record<string, () => SmsProvider> = {};

let override: SmsProvider | null | undefined;
/** Pour les tests : capture les SMS (null = aucun envoi ; undefined = réglages normaux). */
export function setSmsProviderForTests(provider: SmsProvider | null | undefined) {
  override = provider;
}

/** Numéro au format international camerounais (+2376XXXXXXXX) ; null s’il n’est pas exploitable. */
export function normalizeCameroonPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("237") ? digits.slice(3) : digits.startsWith("00237") ? digits.slice(5) : digits;
  return /^6\d{8}$/.test(local) ? `+237${local}` : null;
}

function outboxProvider(): SmsProvider {
  return {
    name: "outbox",
    async send(sms) {
      const dir = process.env.EMAIL_OUTBOX_DIR?.trim() || "outbox";
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = join(dir, `${stamp}_sms_${sms.to.replace(/\D/g, "")}.txt`);
      writeFileSync(file, `SMS de : ${sms.sender}\nÀ : ${sms.to}\n\n${sms.text}\n`, "utf8");
      console.log(`[KOFI] SMS (mode développement, non envoyé) pour ${sms.to} → ${file}`);
    },
  };
}

export function getSmsProvider(): SmsProvider | null {
  if (override !== undefined) return override;
  const name = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (!name || name === "log") return process.env.NODE_ENV === "production" ? null : outboxProvider();
  const factory = PROVIDERS[name];
  if (!factory) console.error(`[KOFI] Opérateur SMS inconnu : ${name}. Aucun SMS envoyé.`);
  return factory ? factory() : null;
}

export const smsSender = () => process.env.SMS_SENDER?.trim() || "KOFI";
