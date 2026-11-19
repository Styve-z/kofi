/**
 * Mode « données légères » pour les connexions lentes ou les forfaits limités :
 * photos plus petites et plus compressées, pas d’écran haute densité, pas d’animation 3D.
 *
 * Choix de l’utilisateur (mémorisé sur l’appareil), sinon automatique : activé quand le navigateur
 * signale l’économiseur de données ou une connexion 2G.
 */
const KEY = "kofi-data-saver";

type Choice = "on" | "off" | "auto";
type NetworkInfo = { saveData?: boolean; effectiveType?: string };

function readChoice(): Choice {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "on" || value === "off" ? value : "auto";
  } catch {
    return "auto";
  }
}

function networkSuggestsSaving() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  return Boolean(connection?.saveData) || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
}

const choice: Choice = typeof window === "undefined" ? "auto" : readChoice();

/** Vrai si les données légères sont actives (fixé au chargement de la page). */
export const dataSaverOn = choice === "on" || (choice === "auto" && networkSuggestsSaving());

/** Active ou coupe le mode, puis recharge la page pour que toutes les images suivent. */
export function setDataSaver(on: boolean) {
  try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* stockage indisponible : réglage non mémorisé */ }
  window.location.reload();
}

if (typeof document !== "undefined" && dataSaverOn) document.documentElement.classList.add("kofi-lite");
