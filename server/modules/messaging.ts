import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { messageOutbox, users } from "../../drizzle/schema";
import type { Database } from "../db";
import { getMailProvider } from "./mailer";
import { getSmsProvider, normalizeCameroonPhone, smsSender } from "./sms";

/**
 * File d’envoi des e-mails et SMS (« outbox ») :
 *  - enqueue* écrit dans la transaction de l’événement : rien ne part si l’action est annulée ;
 *  - dispatchOutbox envoie en arrière-plan, réserve chaque ligne avant l’envoi (pas de doublon
 *    si deux serveurs tournent) et réessaie jusqu’à 5 fois avec un délai croissant.
 */

type Writer = Pick<Database, "insert" | "select">;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export async function enqueueEmail(db: Writer, input: { to: string; subject: string; text: string; kind: string }) {
  await db.insert(messageOutbox).values({ channel: "email", recipient: input.to.trim().toLowerCase(), subject: input.subject.slice(0, 200), body: input.text, kind: input.kind.slice(0, 64) });
}

/** SMS vers un numéro camerounais ; ignoré si le numéro n’est pas exploitable. */
export async function enqueueSms(db: Writer, input: { phone: string | null | undefined; text: string; kind: string }) {
  const to = input.phone ? normalizeCameroonPhone(input.phone) : null;
  if (!to) return false;
  await db.insert(messageOutbox).values({ channel: "sms", recipient: to, body: input.text.slice(0, 480), kind: input.kind.slice(0, 64) });
  return true;
}

/** E-mail vers un compte, seulement si son adresse a été vérifiée. */
export async function enqueueEmailToUser(db: Writer, userId: number, input: { subject: string; text: string; kind: string }) {
  const [user] = await db.select({ email: users.email, name: users.name, emailVerifiedAt: users.emailVerifiedAt, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email || !user.emailVerifiedAt || user.status === "suspended") return false;
  await enqueueEmail(db, { to: user.email, subject: input.subject, text: `Bonjour ${user.name ?? ""},`.trim() + `\n\n${input.text}\n\nL’équipe KOFI`, kind: input.kind });
  return true;
}

/** Envoie les messages en attente. Renvoie le nombre de messages traités. */
export async function dispatchOutbox(db: Database, now = new Date(), limit = 25) {
  const due = await db.select().from(messageOutbox)
    .where(and(eq(messageOutbox.status, "pending"), lte(messageOutbox.sendAfter, now))).orderBy(asc(messageOutbox.id)).limit(limit);
  let processed = 0;
  for (const message of due) {
    // Réservation de la ligne : un seul envoi même si deux serveurs la voient en même temps.
    const [claim] = await db.update(messageOutbox).set({ status: "sending", attempts: sql`${messageOutbox.attempts} + 1` })
      .where(and(eq(messageOutbox.id, message.id), eq(messageOutbox.status, "pending")));
    if (!(claim as { affectedRows?: number }).affectedRows) continue;
    processed += 1;
    const attempts = message.attempts + 1;
    try {
      if (message.channel === "email") {
        const provider = getMailProvider();
        if (!provider) throw new Error("Aucun prestataire e-mail configuré");
        await provider.send({ to: message.recipient, subject: message.subject ?? "KOFI", text: message.body, from: process.env.EMAIL_FROM?.trim() || "KOFI <no-reply@kofi.local>" });
      } else {
        const provider = getSmsProvider();
        if (!provider) throw new Error("Aucun opérateur SMS configuré");
        await provider.send({ to: message.recipient, text: message.body, sender: smsSender() });
      }
      await db.update(messageOutbox).set({ status: "sent", sentAt: new Date(), lastError: null }).where(eq(messageOutbox.id, message.id));
    } catch (error) {
      const failedForGood = attempts >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      await db.update(messageOutbox).set({ status: failedForGood ? "failed" : "pending", lastError: String((error as Error)?.message ?? error).slice(0, 255), sendAfter: new Date(now.getTime() + delay) }).where(eq(messageOutbox.id, message.id));
      console.error(`[KOFI] Envoi ${message.channel} n° ${message.id} en échec (essai ${attempts}/${MAX_ATTEMPTS})`, error);
    }
  }
  return processed;
}

/** Remet en file les messages restés « en cours » après un arrêt brutal du serveur. */
export async function recoverStuckMessages(db: Database, now = new Date()) {
  await db.update(messageOutbox).set({ status: "pending" }).where(and(eq(messageOutbox.status, "sending"), lte(messageOutbox.createdAt, new Date(now.getTime() - 10 * 60_000))));
}

export async function outboxStats(db: Database) {
  const rows = await db.select({ status: messageOutbox.status, channel: messageOutbox.channel, count: sql<number>`count(*)` }).from(messageOutbox)
    .where(inArray(messageOutbox.status, ["pending", "failed", "sent"])).groupBy(messageOutbox.status, messageOutbox.channel);
  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}
