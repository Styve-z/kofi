import type { BookingStatus, Professional } from "./trpc";

/** Le Cameroun (Africa/Douala) est à UTC+1 toute l’année : tous les horaires sont affichés dans ce fuseau. */
const OFFSET_MS = 60 * 60_000;
const pad = (value: number) => String(value).padStart(2, "0");

export const formatXaf = (amount: number) => `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
export const formatDuration = (minutes: number) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h` : ""}${minutes % 60 ? ` ${minutes % 60} min` : ""}`.trim();
export const doualaDay = (instant: Date | string = new Date()) => new Date(new Date(instant).getTime() + OFFSET_MS).toISOString().slice(0, 10);
export const addDays = (day: string, count: number) => doualaDay(new Date(Date.parse(`${day}T12:00:00Z`) - OFFSET_MS + count * 86_400_000));
export const upcomingDays = (count: number, from = doualaDay()) => Array.from({ length: count }, (_, index) => addDays(from, index));

export function formatTime(iso: string) {
  const local = new Date(new Date(iso).getTime() + OFFSET_MS);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

const WEEKDAYS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function formatDayLabel(day: string, today = doualaDay()) {
  if (day === today) return "Aujourd’hui";
  if (day === addDays(today, 1)) return "Demain";
  const date = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export const formatSlot = (iso: string) => `${formatDayLabel(doualaDay(iso))} · ${formatTime(iso)}`;
export const modeLabel = (mode: Professional["mode"]) => (mode === "les deux" ? "Salon & domicile" : mode === "salon" ? "En salon" : "À domicile");

export const STATUS_LABELS: Record<BookingStatus, { label: string; tone: "orange" | "green" | "gray" }> = {
  pending: { label: "En attente", tone: "orange" }, confirmed: { label: "Confirmée", tone: "green" }, completed: { label: "Terminée", tone: "green" },
  refused: { label: "Refusée", tone: "gray" }, cancelled: { label: "Annulée", tone: "gray" }, no_show: { label: "Absence", tone: "gray" },
};

const ERRORS: Record<string, string> = {
  SLOT_UNAVAILABLE: "Ce créneau vient d’être pris. Choisissez-en un autre.",
  SLOT_IN_PAST: "Ce créneau est déjà passé. Choisissez un horaire à venir.",
  SLOT_OUTSIDE_HOURS: "Ce créneau est en dehors des horaires du professionnel.",
  MODE_UNAVAILABLE: "Ce mode de rendez-vous n’est pas disponible pour ce professionnel.",
  CUSTOMER_DETAILS_INVALID: "Vérifiez votre nom et votre numéro de téléphone.",
  ADDRESS_REQUIRED: "Indiquez une adresse complète pour un rendez-vous à domicile.",
  PROFESSIONAL_NOT_FOUND: "Ce professionnel n’est plus disponible.",
  SERVICE_NOT_FOUND: "Une prestation sélectionnée n’est plus disponible.",
  DURATION_MISMATCH: "Les prestations ont changé. Recomposez votre sélection.",
  TOTAL_MISMATCH: "Les tarifs ont changé. Recomposez votre sélection.",
  CONFIRMED_BOOKING_PROTECTED: "Une réservation confirmée ne peut pas être annulée ici : contactez le professionnel.",
  BOOKING_NOT_CANCELLABLE: "Cette réservation ne peut plus être annulée.",
  ACCOUNT_SUSPENDED: "Votre compte est suspendu. Contactez le support KOFI.",
  PROMO_INVALID: "Ce code promo n’existe pas ou n’est plus actif.",
  PROMO_EXPIRED: "Ce code promo n’est pas valable à cette date.",
  PROMO_MIN_TOTAL: "Le montant de votre sélection est trop faible pour ce code.",
  PROMO_EXHAUSTED: "Ce code promo a atteint son nombre maximal d’utilisations.",
  PROMO_ALREADY_USED: "Vous avez déjà utilisé ce code promo.",
  MOBILE_LOGIN_INVALID: "La connexion a expiré. Recommencez.",
  CANCELLATION_TOO_LATE: "Moins de 24 h avant le rendez-vous : voyez directement avec le professionnel.",
  PAYMENTS_DISABLED: "Le paiement en ligne n’est pas encore activé.",
  PAYMENT_NOT_DUE: "Aucun paiement n’est attendu pour cette réservation.",
  PAYMENT_PROVIDER_ERROR: "Le service de paiement ne répond pas. Réessayez dans quelques minutes.",
  REVIEW_NOT_ALLOWED: "Un avis n’est possible que dans les 30 jours suivant un rendez-vous terminé.",
  REVIEW_EXISTS: "Vous avez déjà laissé un avis pour ce rendez-vous.",
  REVIEW_INVALID: "Choisissez une note de 1 à 5.",
};
export const errorText = (message?: string | null) => (message && ERRORS[message]) || (message === "Network request failed" || message === "Failed to fetch" ? "Pas de connexion internet. Réessayez quand le réseau revient." : "Une erreur est survenue. Réessayez dans un instant.");
