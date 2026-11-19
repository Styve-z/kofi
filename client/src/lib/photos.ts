/**
 * Photos d’ambiance libres de droits (licence Unsplash : usage commercial gratuit, sans attribution obligatoire).
 * Elles sont chargées depuis le CDN d’Unsplash, recadrées à la taille demandée.
 * Ce sont des photos D’ILLUSTRATION : elles ne montrent pas le travail des professionnels inscrits sur KOFI.
 * Pour remplacer une photo, changez simplement son identifiant ci-dessous.
 */
import { dataSaverOn } from "./dataSaver";

const PHOTOS = {
  hero: "photo-1567894340315-735d7c361db0", // barbier coupant une coupe afro
  proCta: "photo-1653758265969-b048bb0b328a", // barbier au travail dans son salon
  barbier: "photo-1686671805337-7d8aa64b965f",
  tresses: "photo-1572955304332-bf714bd49add",
  coiffure: "photo-1632765866070-3fadf25d3d5b",
  ongles: "photo-1761735489573-15b2d60280f5",
  maquillage: "photo-1657563920440-0ac6d8932f20",
  soins: "photo-1648203276014-20f97ba1f817",
  salon: "photo-1761839256791-6a93f89fb8b0",
} as const;

export type PhotoKey = keyof typeof PHOTOS;

export function photoUrl(key: PhotoKey, width: number, height?: number) {
  // Données légères : image deux fois plus petite et plus compressée (environ 5 fois moins lourde).
  const scale = dataSaverOn ? 0.5 : 1;
  const params = new URLSearchParams({ auto: "format", fit: "crop", w: String(Math.round(width * scale)), q: dataSaverOn ? "45" : "70" });
  if (height) params.set("h", String(Math.round(height * scale)));
  return `https://images.unsplash.com/${PHOTOS[key]}?${params.toString()}`;
}

/** Jeu de tailles pour les écrans haute densité (une seule taille en mode données légères). */
export function photoSrcSet(key: PhotoKey, width: number, height?: number) {
  if (dataSaverOn) return `${photoUrl(key, width, height)} 1x`;
  return [1, 2].map((scale) => `${photoUrl(key, width * scale, height ? height * scale : undefined)} ${scale}x`).join(", ");
}

/** Catégories mises en avant sur l’accueil (le libellé sert aussi de recherche). */
export const CATEGORY_TILES: { key: PhotoKey; label: string; query: string }[] = [
  { key: "coiffure", label: "Coiffure", query: "Cheveux" },
  { key: "barbier", label: "Barbier", query: "Barbier" },
  { key: "tresses", label: "Tresses & nattes", query: "Tresses" },
  { key: "ongles", label: "Ongles", query: "Ongles" },
  { key: "maquillage", label: "Maquillage", query: "Maquillage" },
  { key: "soins", label: "Soins", query: "Soins" },
];

/** Photo d’illustration selon les spécialités d’un professionnel. */
export function illustrationFor(specialties: string[]): PhotoKey {
  const text = specialties.join(" ").toLowerCase();
  if (/barb|dégrad|degrad|rasage/.test(text)) return "barbier";
  if (/texturé|naturel|afro/.test(text)) return "coiffure";
  if (/tress|natt|braid|locks|dread/.test(text)) return "tresses";
  if (/ongle|manucure|pédicure|pedicure|nail/.test(text)) return "ongles";
  if (/maquill|make/.test(text)) return "maquillage";
  if (/soin|visage|esthét|esthet|spa/.test(text)) return "soins";
  return "salon";
}
