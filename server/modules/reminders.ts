import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { bookings, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { notify, smsToCustomer } from "./notifications";
import { formatDoualaSlot } from "./time";

/**
 * Rappel « la veille » : pour chaque rendez-vous confirmé qui commence dans les 24 h,
 * le client reçoit une notification (et l’e-mail si son adresse est vérifiée) et un SMS, une seule fois.
 * Pas de rappel pour un rendez-vous pris moins de 24 h à l’avance : la confirmation vient d’arriver.
 */
export const REMINDER_LEAD_MS = 24 * 60 * 60_000;
const MIN_BOOKED_AHEAD_MS = 24 * 60 * 60_000;

export async function sendDueReminders(db: Database, now = new Date()) {
  const due = await db.select({ booking: bookings, proName: professionalProfiles.displayName }).from(bookings)
    .innerJoin(professionalProfiles, eq(professionalProfiles.id, bookings.professionalId))
    .where(and(eq(bookings.status, "confirmed"), isNull(bookings.reminderSentAt), gt(bookings.startsAt, now), lte(bookings.startsAt, new Date(now.getTime() + REMINDER_LEAD_MS))))
    .limit(100);
  let sent = 0;
  for (const { booking, proName } of due) {
    await db.transaction(async (tx) => {
      // Marquage d’abord, sous condition : un seul rappel même si deux serveurs passent en même temps.
      const [claim] = await tx.update(bookings).set({ reminderSentAt: now }).where(and(eq(bookings.id, booking.id), isNull(bookings.reminderSentAt), eq(bookings.status, "confirmed")));
      if (!(claim as { affectedRows?: number }).affectedRows) return;
      if (booking.startsAt.getTime() - booking.createdAt.getTime() < MIN_BOOKED_AHEAD_MS) return;
      await notify(tx, { userId: booking.customerUserId, type: "booking.reminder", title: "Rappel : votre rendez-vous approche", body: `${proName} · ${formatDoualaSlot(booking.startsAt)} · réf. ${booking.reference}. Un empêchement ? Annulez ou déplacez depuis vos réservations.`, link: "/mes-reservations" });
      await smsToCustomer(tx, booking, "reminder", proName);
      sent += 1;
    });
  }
  return sent;
}
