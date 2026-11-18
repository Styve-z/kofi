import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { auditLogs, bookings, professionalProfiles, reports, users } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { notify } from "./notifications";

/** Signalements et réclamations : envoyés par un client connecté, traités par l’équipe KOFI. */

export type ReportCategory = "no_show_pro" | "quality" | "price" | "behavior" | "safety" | "other";
export type ReportStatus = "open" | "in_progress" | "resolved" | "rejected";
const DAILY_LIMIT = 10;

export async function createReport(db: Database, userId: number, input: { bookingReference?: string; category: ReportCategory; message: string }, now = new Date()) {
  const message = input.message.trim();
  if (message.length < 10 || message.length > 2000) throw new BusinessError("REPORT_INVALID");
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(reports).where(and(eq(reports.reporterUserId, userId), gte(reports.createdAt, new Date(now.getTime() - 86_400_000))));
  if (Number(count) >= DAILY_LIMIT) throw new BusinessError("REPORT_LIMIT");
  let bookingId: number | null = null;
  let professionalId: number | null = null;
  if (input.bookingReference) {
    // On ne peut signaler que ses propres réservations.
    const [booking] = await db.select().from(bookings).where(eq(bookings.reference, input.bookingReference)).limit(1);
    if (!booking || booking.customerUserId !== userId) throw new BusinessError("BOOKING_NOT_FOUND");
    bookingId = booking.id;
    professionalId = booking.professionalId;
  }
  const [inserted] = await db.insert(reports).values({ reporterUserId: userId, bookingId, professionalId, category: input.category, message, status: "open" }).$returningId();
  return { id: inserted.id, status: "open" as const };
}

async function describe(db: Database, rows: (typeof reports.$inferSelect)[]) {
  const bookingIds = [...new Set(rows.map((row) => row.bookingId).filter((id): id is number => id !== null))];
  const proIds = [...new Set(rows.map((row) => row.professionalId).filter((id): id is number => id !== null))];
  const userIds = [...new Set(rows.flatMap((row) => [row.reporterUserId, row.handledByUserId]).filter((id): id is number => id !== null))];
  const [bookingRows, proRows, userRows] = await Promise.all([
    bookingIds.length ? db.select({ id: bookings.id, reference: bookings.reference, startsAt: bookings.startsAt }).from(bookings).where(inArray(bookings.id, bookingIds)) : [],
    proIds.length ? db.select({ id: professionalProfiles.id, name: professionalProfiles.displayName, slug: professionalProfiles.slug }).from(professionalProfiles).where(inArray(professionalProfiles.id, proIds)) : [],
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
  ]);
  return rows.map((row) => {
    const booking = bookingRows.find((item) => item.id === row.bookingId);
    const pro = proRows.find((item) => item.id === row.professionalId);
    return {
      id: row.id, category: row.category, message: row.message, status: row.status, resolutionNote: row.resolutionNote,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      reporter: userRows.find((item) => item.id === row.reporterUserId)?.name ?? `Utilisateur #${row.reporterUserId}`,
      handledBy: row.handledByUserId ? userRows.find((item) => item.id === row.handledByUserId)?.name ?? null : null,
      booking: booking ? { reference: booking.reference, startsAt: booking.startsAt.toISOString() } : null,
      professional: pro ? { name: pro.name, slug: pro.slug } : null,
    };
  });
}

export async function listMyReports(db: Database, userId: number) {
  const rows = await db.select().from(reports).where(eq(reports.reporterUserId, userId)).orderBy(desc(reports.id)).limit(50);
  return describe(db, rows);
}

export async function listReports(db: Database, input: { status?: ReportStatus } = {}) {
  const rows = await db.select().from(reports).where(input.status ? eq(reports.status, input.status) : undefined).orderBy(desc(reports.id)).limit(200);
  const statusCounts = await db.select({ status: reports.status, count: sql<number>`count(*)` }).from(reports).groupBy(reports.status);
  const counts = { open: 0, in_progress: 0, resolved: 0, rejected: 0 } as Record<ReportStatus, number>;
  for (const row of statusCounts) counts[row.status] = Number(row.count);
  return { counts, items: await describe(db, rows) };
}

const STATUS_ACTIONS: Record<ReportStatus, string> = { open: "Signalement rouvert", in_progress: "Signalement pris en charge", resolved: "Signalement résolu", rejected: "Signalement classé sans suite" };

/** Clôturer (résolu ou classé) exige une réponse : elle est visible par le client. */
export async function updateReport(db: Database, actorUserId: number, input: { id: number; status: ReportStatus; note?: string }) {
  const note = input.note?.trim() || null;
  if ((input.status === "resolved" || input.status === "rejected") && (!note || note.length < 3)) throw new BusinessError("REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, input.id)).limit(1).for("update");
    if (!report) throw new BusinessError("REPORT_NOT_FOUND");
    if (report.status === input.status) throw new BusinessError("INVALID_TRANSITION");
    await tx.update(reports).set({ status: input.status, resolutionNote: note ?? report.resolutionNote, handledByUserId: actorUserId }).where(eq(reports.id, report.id));
    if (input.status === "resolved" || input.status === "rejected") await notify(tx, { userId: report.reporterUserId, type: `report.${input.status}`, title: input.status === "resolved" ? "Votre signalement est résolu" : "Votre signalement a été examiné", body: note, link: "/mes-reservations" });
    await tx.insert(auditLogs).values({ actorUserId, action: STATUS_ACTIONS[input.status], entityType: "report", entityId: String(report.id), metadata: JSON.stringify({ name: `Signalement n° ${report.id}`, from: report.status, to: input.status, note }) });
    return { id: report.id, status: input.status };
  });
}

export async function countOpenReports(db: Database) {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(reports).where(inArray(reports.status, ["open", "in_progress"]));
  return Number(row.count);
}
