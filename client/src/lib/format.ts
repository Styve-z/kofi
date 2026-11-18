import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Outputs = inferRouterOutputs<AppRouter>;
export type Professional = Outputs["catalog"]["search"][number];
export type Service = Professional["services"][number];
export type Booking = Outputs["booking"]["mine"][number];
export type BookingStatus = Booking["status"];

/** Le Cameroun (Africa/Douala) est à UTC+1 toute l’année : tous les horaires sont affichés dans ce fuseau. */
export const DOUALA_TZ = "Africa/Douala";
const OFFSET_MS = 60 * 60_000;

export const formatXaf = (amount: number) => `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
export const formatDuration = (minutes: number) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h` : ""}${minutes % 60 ? ` ${minutes % 60} min` : ""}`.trim();

/** Jour `AAAA-MM-JJ` à Douala. */
export const doualaDay = (instant: Date | string = new Date()) => new Date(new Date(instant).getTime() + OFFSET_MS).toISOString().slice(0, 10);
export const addDays = (day: string, count: number) => doualaDay(new Date(Date.parse(`${day}T12:00:00Z`) - OFFSET_MS + count * 86_400_000));
export const upcomingDays = (count: number, from = doualaDay()) => Array.from({ length: count }, (_, index) => addDays(from, index));

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: DOUALA_TZ, hour: "2-digit", minute: "2-digit" });

export function formatDayLabel(day: string, today = doualaDay()) {
  if (day === today) return "Aujourd’hui";
  if (day === addDays(today, 1)) return "Demain";
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** « Demain · 09:30 », « Ven. 21 nov. · 14:00 »… en heure de Douala. */
export const formatSlot = (iso: string) => `${formatDayLabel(doualaDay(iso))} · ${formatTime(iso)}`;

export const STATUS_LABELS: Record<BookingStatus, { label: string; tone: "orange" | "green" | "gray" }> = {
  pending: { label: "En attente", tone: "orange" },
  confirmed: { label: "Confirmée", tone: "green" },
  completed: { label: "Terminée", tone: "green" },
  refused: { label: "Refusée", tone: "gray" },
  cancelled: { label: "Annulée", tone: "gray" },
  no_show: { label: "Absence", tone: "gray" },
};

export const modeLabel = (mode: Professional["mode"]) => (mode === "les deux" ? "Salon & domicile" : mode === "salon" ? "En salon" : "À domicile");

/** Instant ISO (UTC) correspondant à un jour `AAAA-MM-JJ` et une heure `HH:mm` saisis en heure de Douala (UTC+1). */
export const doualaToIso = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`).toISOString();
