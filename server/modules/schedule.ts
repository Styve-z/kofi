import { and, eq, gte, max } from "drizzle-orm";
import { availabilitySlots, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { addDays, doualaDateTime, doualaDay, doualaWeekday } from "./time";

/**
 * Horaires types d’un professionnel : pour chaque jour de la semaine (0 = dimanche … 6 = samedi),
 * une plage d’ouverture, ou rien si le jour est fermé.
 * Les plages datées (`availability_slots`, statut « open ») sont générées à partir de ce modèle
 * sur un horizon glissant de 60 jours ; congés et blocages restent des lignes séparées.
 */
export type WeeklyHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", { open: string; close: string }>>;

export const HORIZON_DAYS = 60;
const EXTEND_WHEN_LESS_THAN_DAYS = 45;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  "1": { open: "09:00", close: "18:00" }, "2": { open: "09:00", close: "18:00" }, "3": { open: "09:00", close: "18:00" },
  "4": { open: "09:00", close: "18:00" }, "5": { open: "09:00", close: "18:00" }, "6": { open: "09:00", close: "18:00" },
};

export function parseWeeklyHours(value: string | null): WeeklyHours | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return isValidWeeklyHours(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isValidWeeklyHours(value: unknown): value is WeeklyHours {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([day, hours]) => {
    if (!/^[0-6]$/.test(day) || !hours || typeof hours !== "object") return false;
    const { open, close } = hours as { open?: unknown; close?: unknown };
    return typeof open === "string" && typeof close === "string" && TIME.test(open) && TIME.test(close) && open < close;
  });
}

type Executor = Pick<Database, "select" | "insert" | "delete">;

function rowsFor(professionalId: number, hours: WeeklyHours, firstDay: string, days: number) {
  const rows: (typeof availabilitySlots.$inferInsert)[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(firstDay, offset);
    const slot = hours[String(doualaWeekday(day)) as keyof WeeklyHours];
    if (slot) rows.push({ professionalId, startsAt: doualaDateTime(day, slot.open), endsAt: doualaDateTime(day, slot.close), status: "open", note: null });
  }
  return rows;
}

/** Remplace toutes les plages ouvertes à partir d’aujourd’hui par celles du modèle. Les réservations existantes ne sont pas touchées. */
export async function regenerateOpenSlots(db: Executor, professionalId: number, hours: WeeklyHours, now = new Date()) {
  const today = doualaDay(now);
  await db.delete(availabilitySlots).where(and(eq(availabilitySlots.professionalId, professionalId), eq(availabilitySlots.status, "open"), gte(availabilitySlots.startsAt, doualaDateTime(today, "00:00"))));
  const rows = rowsFor(professionalId, hours, today, HORIZON_DAYS);
  if (rows.length) await db.insert(availabilitySlots).values(rows);
  return rows.length;
}

/**
 * Prolonge l’horizon d’ouverture quand il devient court (appelé avant de calculer des créneaux
 * ou d’enregistrer une réservation). À appeler avec la ligne du professionnel verrouillée.
 */
export async function extendHorizon(db: Executor, professionalId: number, weeklyHours: string | null, now = new Date()) {
  const hours = parseWeeklyHours(weeklyHours);
  if (!hours) return 0;
  const today = doualaDay(now);
  const [{ last }] = await db.select({ last: max(availabilitySlots.startsAt) }).from(availabilitySlots).where(and(eq(availabilitySlots.professionalId, professionalId), eq(availabilitySlots.status, "open")));
  const lastDay = last ? doualaDay(last) : null;
  if (lastDay && lastDay >= addDays(today, EXTEND_WHEN_LESS_THAN_DAYS)) return 0;
  const firstDay = lastDay && lastDay >= today ? addDays(lastDay, 1) : today;
  const until = addDays(today, HORIZON_DAYS);
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000);
  const rows = days > 0 ? rowsFor(professionalId, hours, firstDay, days) : [];
  if (rows.length) await db.insert(availabilitySlots).values(rows);
  return rows.length;
}

/** Version autonome : verrouille le professionnel le temps de prolonger son horizon. */
export async function ensureHorizon(db: Database, professionalId: number, now = new Date()) {
  await db.transaction(async (tx) => {
    const [profile] = await tx.select({ weeklyHours: professionalProfiles.weeklyHours }).from(professionalProfiles).where(eq(professionalProfiles.id, professionalId)).limit(1).for("update");
    if (profile) await extendHorizon(tx, professionalId, profile.weeklyHours, now);
  });
}
