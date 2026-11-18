import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { notifications, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { formatDoualaSlot } from "./time";

/**
 * Notifications dans le site et l’application. Elles sont écrites dans la même transaction que
 * l’événement : pas de notification pour une action annulée, pas d’action sans notification.
 * Un futur envoi SMS/WhatsApp pourra lire cette table (voir documentation/integrations.md).
 */

type Writer = Pick<Database, "insert" | "select">;
export type NotificationInput = { userId: number | null | undefined; type: string; title: string; body?: string | null; link?: string | null };

export async function notify(db: Writer, input: NotificationInput) {
  if (!input.userId) return;
  await db.insert(notifications).values({ userId: input.userId, type: input.type, title: input.title.slice(0, 180), body: input.body ?? null, link: input.link ?? null });
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

/** Prévient le client quand le statut de sa réservation change (sauf « absence »). */
export async function notifyCustomerOfStatus(db: Writer, booking: { customerUserId: number | null; reference: string; startsAt: Date }, status: string, professionalName: string, note?: string | null) {
  const title = STATUS_MESSAGES[status];
  if (!title) return;
  await notify(db, { userId: booking.customerUserId, type: `booking.${status}`, title, body: `${professionalName} · ${formatDoualaSlot(booking.startsAt)}${note ? ` · ${note}` : ""}`, link: "/mes-reservations" });
}
