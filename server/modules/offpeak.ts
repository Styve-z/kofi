import { and, asc, eq, inArray } from "drizzle-orm";
import { offpeakRules, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";

/**
 * Remises « heures creuses » définies par le professionnel : un pourcentage (5 à 50 %) appliqué aux
 * rendez-vous qui COMMENCENT dans une tranche horaire d’un jour de la semaine (heure de Douala).
 * La remise est toujours recalculée par le serveur à la création de la réservation.
 */
export type OffpeakRule = { id: number; dayOfWeek: number; startTime: string; endTime: string; percent: number };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DOUALA_OFFSET_MS = 60 * 60_000;

/** Jour de semaine et heure « HH:MM » à Douala pour un instant. */
function localParts(instant: Date) {
  const local = new Date(instant.getTime() + DOUALA_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return { day: local.getUTCDay(), time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}` };
}

/** Meilleure remise applicable à un départ donné (0 si aucune). */
export function offpeakPercentAt(rules: OffpeakRule[], startsAt: Date) {
  const { day, time } = localParts(startsAt);
  return rules.filter((rule) => rule.dayOfWeek === day && time >= rule.startTime && time < rule.endTime).reduce((best, rule) => Math.max(best, rule.percent), 0);
}

/** Montant de la remise, arrondi aux 50 FCFA inférieurs (jamais en faveur d’un prix « bizarre »). */
export const offpeakDiscountXaf = (subtotalXaf: number, percent: number) => (percent > 0 ? Math.floor((subtotalXaf * percent) / 100 / 50) * 50 : 0);

export async function activeRules(db: Pick<Database, "select">, professionalIds: number[]): Promise<Map<number, OffpeakRule[]>> {
  const map = new Map<number, OffpeakRule[]>();
  if (!professionalIds.length) return map;
  const rows = await db.select().from(offpeakRules).where(and(inArray(offpeakRules.professionalId, professionalIds), eq(offpeakRules.isActive, 1))).orderBy(asc(offpeakRules.dayOfWeek), asc(offpeakRules.startTime));
  for (const row of rows) {
    const list = map.get(row.professionalId) ?? [];
    list.push({ id: row.id, dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, percent: row.percent });
    map.set(row.professionalId, list);
  }
  return map;
}

async function myProfileId(db: Database, userId: number) {
  const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
  return profile.id;
}

export async function listMyOffpeak(db: Database, userId: number) {
  const id = await myProfileId(db, userId);
  return (await activeRules(db, [id])).get(id) ?? [];
}

export async function addOffpeakRule(db: Database, userId: number, input: { dayOfWeek: number; startTime: string; endTime: string; percent: number }) {
  const id = await myProfileId(db, userId);
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6 || !HHMM.test(input.startTime) || !HHMM.test(input.endTime) || input.startTime >= input.endTime) throw new BusinessError("OFFPEAK_INVALID");
  if (!Number.isInteger(input.percent) || input.percent < 5 || input.percent > 50) throw new BusinessError("OFFPEAK_INVALID");
  const existing = (await activeRules(db, [id])).get(id) ?? [];
  if (existing.length >= 20) throw new BusinessError("OFFPEAK_INVALID");
  await db.insert(offpeakRules).values({ professionalId: id, dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime, percent: input.percent });
  return { ok: true as const };
}

export async function removeOffpeakRule(db: Database, userId: number, ruleId: number) {
  const id = await myProfileId(db, userId);
  await db.update(offpeakRules).set({ isActive: 0 }).where(and(eq(offpeakRules.id, ruleId), eq(offpeakRules.professionalId, id)));
  return { ok: true as const };
}
