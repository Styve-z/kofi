import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { notifications, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { appUrl } from "./mailer";
import { enqueueEmailToUser, enqueueSms } from "./messaging";
import { formatDoualaSlot } from "./time";

/**
 * Notifications dans le site et l’application. Elles sont écrites dans la même transaction que
 * l’événement : pas de notification pour une action annulée, pas d’action sans notification.
 * Chaque notification part aussi par e-mail si l’adresse du compte est vérifiée (file message_outbox),
 * et les étapes clés d’une réservation partent par SMS au numéro saisi par le client.
 */

type Writer = Pick<Database, "insert" | "select">;
export type NotificationInput = { userId: number | null | undefined; type: string; title: string; body?: string | null; link?: string | null };

export async function notify(db: Writer, input: NotificationInput) {
  if (!input.userId) return;
  await db.insert(notifications).values({ userId: input.userId, type: input.type, title: input.title.slice(0, 180), body: input.body ?? null, link: input.link ?? null });
  await enqueueEmailToUser(db, input.userId, {
    subject: `KOFI · ${input.title}`.slice(0, 200),
    text: [input.body, input.link ? `Voir sur KOFI : ${appUrl()}${input.link}` : null].filter(Boolean).join("\n\n"),
    kind: input.type,
  });
}

/** Prévenir le titulaire du profil professionnel, s’il est rattaché à un compte. */
export async function notifyProfessional(db: Writer, professionalId: number, input: Omit<NotificationInput, "userId">) {
  const [profile] = await db.select({ ownerUserId: professionalProfiles.ownerUserId }).from(professionalProfiles).where(eq(professionalProfiles.id, professionalId)).limit(1);
  await notify(db, { ...input, userId: profile?.ownerUserId });
}

export async function listNotifications(db: Database, userId: number, limit = 50) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.id)).limit(Math.min(limit, 100));
  return rows.map((row) => ({ id: row.id, type: row.type, title: row.title, body: row.body, link: row.link, read: row.readAt !== null, createdAt: row.createdAt.toISOString() }));
}

export async function unreadCount(db: Database, userId: number) {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row.count);
}

/** Marque une notification (ou toutes) comme lue ; seulement celles du compte connecté. */
export async function markRead(db: Database, userId: number, id?: number) {
  const filters = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (id) filters.push(eq(notifications.id, id));
  await db.update(notifications).set({ readAt: new Date() }).where(and(...filters));
  return { unread: await unreadCount(db, userId) };
}

const STATUS_MESSAGES: Partial<Record<string, string>> = {
  confirmed: "Rendez-vous confirmé",
  refused: "Demande refusée",
  cancelled: "Rendez-vous annulé",
  completed: "Merci pour votre visite : donnez votre avis",
};

/** SMS courts (un seul message de 160 caractères autant que possible). */
const SMS_MESSAGES: Partial<Record<string, (pro: string, when: string, ref: string) => string>> = {
  created: (pro, when, ref) => `KOFI : demande envoyée à ${pro} pour le ${when}. Vous serez prévenu dès sa réponse. Réf. ${ref}`,
  confirmed: (pro, when, ref) => `KOFI : RDV confirmé chez ${pro} le ${when}. Réf. ${ref}`,
  refused: (pro, when, ref) => `KOFI : ${pro} ne peut pas vous recevoir le ${when}. Choisissez un autre créneau sur KOFI. Réf. ${ref}`,
  cancelled: (pro, when, ref) => `KOFI : votre RDV chez ${pro} du ${when} est annulé. Réf. ${ref}`,
  reminder: (pro, when, ref) => `KOFI : rappel de votre RDV chez ${pro} demain, ${when}. Empêchement ? Annulez sur KOFI. Réf. ${ref}`,
};

export async function smsToCustomer(db: Writer, booking: { reference: string; startsAt: Date; customerPhone?: string | null }, kind: keyof typeof SMS_MESSAGES, professionalName: string) {
  const sms = SMS_MESSAGES[kind];
  if (!sms) return false;
  return enqueueSms(db, { phone: booking.customerPhone, text: sms(professionalName, formatDoualaSlot(booking.startsAt), booking.reference), kind: `booking.${kind}` });
}

/** Prévient le client quand le statut de sa réservation change (sauf « absence ») : site, e-mail et SMS. */
export async function notifyCustomerOfStatus(db: Writer, booking: { customerUserId: number | null; reference: string; startsAt: Date; customerPhone?: string | null }, status: string, professionalName: string, note?: string | null) {
  const title = STATUS_MESSAGES[status];
  if (!title) return;
  await notify(db, { userId: booking.customerUserId, type: `booking.${status}`, title, body: `${professionalName} · ${formatDoualaSlot(booking.startsAt)}${note ? ` · ${note}` : ""}`, link: "/mes-reservations" });
  if (status === "confirmed" || status === "refused" || status === "cancelled") await smsToCustomer(db, booking, status, professionalName);
}
