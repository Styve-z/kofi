import { and, eq, gte, inArray } from "drizzle-orm";
import { availabilitySlots, professionalProfiles, serviceCatalog } from "../../drizzle/schema";
import type { Database } from "../db";
import { addDays, doualaDateTime, doualaDay, doualaWeekday } from "./time";

/**
 * Données de DÉMONSTRATION uniquement (profils fictifs, signalés comme tels dans l’interface).
 * Le seed est idempotent : profils et prestations sont mis à jour par slug / code,
 * et les plages d’ouverture futures sont régénérées.
 */
type DemoPro = {
  slug: string; displayName: string; salonName: string; city: string; neighborhood: string; mode: "salon" | "domicile" | "les deux";
  bio: string; specialties: string[]; accentColor: string; verificationStatus: "pending" | "verified"; rating: string; reviewCount: number;
  hours: { open: string; close: string; days: number[] };
  services: { code: string; name: string; category: string; durationMinutes: number; preparationMinutes?: number; priceXaf: number }[];
};

export const DEMO_PROFESSIONALS: DemoPro[] = [
  {
    slug: "mireille-nkoulou", displayName: "Mireille Nkoulou", salonName: "Atelier M", city: "Douala", neighborhood: "Bonapriso", mode: "les deux",
    bio: "Démonstration — une approche précise et douce pour révéler la texture naturelle, au salon ou à domicile.",
    specialties: ["Cheveux texturés", "Tresses", "Soins"], accentColor: "#F47A45", verificationStatus: "verified", rating: "4.90", reviewCount: 38,
    hours: { open: "08:00", close: "18:00", days: [1, 2, 3, 4, 5, 6] },
    services: [
      { code: "mireille-twist", name: "Twists protecteurs", category: "Tresses", durationMinutes: 150, priceXaf: 18000 },
      { code: "mireille-soin", name: "Soin profond + définition", category: "Soins", durationMinutes: 75, priceXaf: 10000 },
      { code: "mireille-coupe", name: "Coupe et mise en forme", category: "Coupe", durationMinutes: 60, priceXaf: 8000 },
    ],
  },
  {
    slug: "cedric-mbarga", displayName: "Cédric Mbarga", salonName: "Cédric Studio", city: "Yaoundé", neighborhood: "Bastos", mode: "salon",
    bio: "Démonstration — un studio calme, des finitions nettes et un vrai sens du détail.",
    specialties: ["Barbier", "Dégradé", "Barbe"], accentColor: "#2F6654", verificationStatus: "verified", rating: "4.80", reviewCount: 61,
    hours: { open: "09:00", close: "20:00", days: [1, 2, 3, 4, 5, 6] },
    services: [
      { code: "cedric-fade", name: "Dégradé signature", category: "Barbier", durationMinutes: 50, priceXaf: 7000 },
      { code: "cedric-barbe", name: "Taille de barbe", category: "Barbe", durationMinutes: 30, priceXaf: 4000 },
      { code: "cedric-duo", name: "Coupe + barbe", category: "Formule", durationMinutes: 75, priceXaf: 10000 },
    ],
  },
  {
    slug: "sandra-essomba", displayName: "Sandra Essomba", salonName: "Maison S", city: "Douala", neighborhood: "Akwa", mode: "salon",
    bio: "Démonstration — du brushing de semaine à la mise en beauté d’un événement. Diagnostic inclus avant coloration.",
    specialties: ["Coloration", "Brushing", "Événement"], accentColor: "#9A5B36", verificationStatus: "pending", rating: "4.70", reviewCount: 24,
    hours: { open: "09:00", close: "19:00", days: [2, 3, 4, 5, 6] },
    services: [
      { code: "sandra-brush", name: "Brushing + finition", category: "Brushing", durationMinutes: 60, priceXaf: 9000 },
      { code: "sandra-color", name: "Diagnostic + coloration", category: "Coloration", durationMinutes: 135, preparationMinutes: 15, priceXaf: 25000 },
      { code: "sandra-event", name: "Mise en beauté événement", category: "Événement", durationMinutes: 120, priceXaf: 22000 },
    ],
  },
  {
    slug: "joelle-ndongo", displayName: "Joëlle Ndongo", salonName: "Joëlle à domicile", city: "Bafoussam", neighborhood: "Centre-ville", mode: "domicile",
    bio: "Démonstration — Joëlle se déplace avec son matériel pour des rendez-vous sereins, notamment pour les familles.",
    specialties: ["Nattes", "Enfants", "Domicile"], accentColor: "#B47C2C", verificationStatus: "verified", rating: "5.00", reviewCount: 17,
    hours: { open: "08:00", close: "17:00", days: [1, 2, 3, 4, 5, 6] },
    services: [
      { code: "joelle-nattes", name: "Nattes classiques", category: "Nattes", durationMinutes: 120, priceXaf: 12000 },
      { code: "joelle-enfant", name: "Coiffure enfant", category: "Enfants", durationMinutes: 60, priceXaf: 6000 },
      { code: "joelle-domicile", name: "Déplacement + prestation", category: "Domicile", durationMinutes: 180, priceXaf: 20000 },
    ],
  },
];

export async function seedDemo(db: Database, options: { from?: Date; days?: number } = {}) {
  const firstDay = doualaDay(options.from ?? new Date());
  const days = options.days ?? 60;
  let slots = 0;
  for (const pro of DEMO_PROFESSIONALS) {
    const weeklyHours = Object.fromEntries(pro.hours.days.map((day) => [String(day), { open: pro.hours.open, close: pro.hours.close }]));
    const profile = { weeklyHours: JSON.stringify(weeklyHours), slug: pro.slug, displayName: pro.displayName, salonName: pro.salonName, city: pro.city, neighborhood: pro.neighborhood, mode: pro.mode, bio: pro.bio, specialties: JSON.stringify(pro.specialties), accentColor: pro.accentColor, verificationStatus: pro.verificationStatus, rating: pro.rating, reviewCount: pro.reviewCount };
    await db.insert(professionalProfiles).values(profile).onDuplicateKeyUpdate({ set: profile });
    const [{ id }] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.slug, pro.slug)).limit(1);
    for (const service of pro.services) {
      const values = { professionalId: id, code: service.code, name: service.name, category: service.category, durationMinutes: service.durationMinutes, preparationMinutes: service.preparationMinutes ?? 0, priceXaf: service.priceXaf, isActive: 1 };
      await db.insert(serviceCatalog).values(values).onDuplicateKeyUpdate({ set: values });
    }
    const start = doualaDateTime(firstDay, "00:00");
    await db.delete(availabilitySlots).where(and(eq(availabilitySlots.professionalId, id), gte(availabilitySlots.startsAt, start), inArray(availabilitySlots.status, ["open"])));
    const rows = [];
    for (let offset = 0; offset < days; offset++) {
      const day = addDays(firstDay, offset);
      if (!pro.hours.days.includes(doualaWeekday(day))) continue;
      rows.push({ professionalId: id, startsAt: doualaDateTime(day, pro.hours.open), endsAt: doualaDateTime(day, pro.hours.close), status: "open" as const, note: "Horaires de démonstration" });
    }
    if (rows.length) await db.insert(availabilitySlots).values(rows);
    slots += rows.length;
  }
  return { professionals: DEMO_PROFESSIONALS.length, services: DEMO_PROFESSIONALS.reduce((sum, pro) => sum + pro.services.length, 0), openingDays: slots };
}
