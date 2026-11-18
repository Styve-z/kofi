import { getDb } from "./db";
import { dispatchOutbox, recoverStuckMessages } from "./modules/messaging";
import { sendDueReminders } from "./modules/reminders";

/**
 * Tâches de fond du serveur : envoi de la file e-mail/SMS (toutes les 20 s) et rappels de la veille
 * (toutes les 5 min). BACKGROUND_JOBS=off les désactive (par exemple sur une instance secondaire).
 */
let started = false;

export function startBackgroundJobs() {
  if (started || process.env.BACKGROUND_JOBS === "off") return;
  started = true;
  let busyOutbox = false;
  let busyReminders = false;

  const runOutbox = async () => {
    if (busyOutbox) return;
    busyOutbox = true;
    try {
      const db = await getDb();
      if (db) await dispatchOutbox(db);
    } catch (error) {
      console.error("[KOFI] File d’envoi : erreur", error);
    } finally {
      busyOutbox = false;
    }
  };
  const runReminders = async () => {
    if (busyReminders) return;
    busyReminders = true;
    try {
      const db = await getDb();
      if (db) {
        await recoverStuckMessages(db);
        const sent = await sendDueReminders(db);
        if (sent) console.log(`[KOFI] ${sent} rappel(s) de rendez-vous envoyé(s).`);
      }
    } catch (error) {
      console.error("[KOFI] Rappels : erreur", error);
    } finally {
      busyReminders = false;
    }
  };

  setInterval(runOutbox, 20_000).unref();
  setInterval(runReminders, 5 * 60_000).unref();
  setTimeout(() => { void runReminders(); void runOutbox(); }, 5_000).unref();
}
