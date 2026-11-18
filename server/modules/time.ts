/**
 * Le Cameroun (Africa/Douala) est à UTC+1 toute l’année, sans heure d’été.
 * On s’appuie quand même sur Intl pour formater, et sur un décalage fixe pour les calculs.
 */
export const DOUALA_TZ = "Africa/Douala";
const DOUALA_OFFSET_MINUTES = 60;

/** Instant UTC correspondant à `YYYY-MM-DD` + `HH:mm` en heure de Douala. */
export function doualaDateTime(day: string, time = "00:00"): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) throw new Error("INVALID_DATE");
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - DOUALA_OFFSET_MINUTES * 60_000);
}

/** Jour calendaire (`YYYY-MM-DD`) à Douala pour un instant donné. */
export function doualaDay(instant: Date): string {
  return new Date(instant.getTime() + DOUALA_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** 0 = dimanche … 6 = samedi, à Douala. */
export function doualaWeekday(day: string): number {
  return doualaDateTime(day, "12:00").getUTCDay();
}

export function addDays(day: string, days: number): string {
  return doualaDay(new Date(doualaDateTime(day, "12:00").getTime() + days * 86_400_000));
}

export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « mar. 18 nov. à 10:00 », en heure de Douala (pour les textes de notification). */
export function formatDoualaSlot(instant: Date) {
  const local = new Date(instant.getTime() + DOUALA_OFFSET_MINUTES * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${WEEKDAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} à ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}
