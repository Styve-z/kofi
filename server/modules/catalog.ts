import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { availabilitySlots, bookings, professionalProfiles, serviceCatalog } from "../../drizzle/schema";
import type { Database } from "../db";
import { resolveSelection } from "./booking";
import { ensureHorizon } from "./schedule";
import { doualaDateTime, overlaps } from "./time";
import { activeRules, offpeakPercentAt, type OffpeakRule } from "./offpeak";
import { freeStaffFor, staffByProfessional, staffCandidates, type StaffMember } from "./staff";

export type ProfessionalMode = "salon" | "domicile" | "les deux";
export type CatalogService = { id: string; name: string; duration: number; preparation: number; price: number; category: string };
export type CatalogProfessional = {
  id: string; slug: string; name: string; salon: string; city: string; neighborhood: string; specialties: string[];
  rating: number; reviewCount: number; mode: ProfessionalMode; verified: boolean; bio: string; accent: string; timezone: string;
  services: CatalogService[];
  /** Prix de la prestation la moins chère (« dès … FCFA »). */
  priceFrom: number;
  /** Badge « Top Rated » : note ≥ 4,5 sur au moins 3 avis vérifiés. */
  topRated: boolean;
  /** Plus forte remise heures creuses proposée (0 si aucune). */
  offpeakMaxPercent: number;
  offpeakRules: OffpeakRule[];
  staff: StaffMember[];
  createdAt: string;
};

export type SearchSort = "recommended" | "rating" | "price_asc" | "price_desc" | "newest";
export type SearchInput = { query?: string; city?: string; mode?: string; maxPrice?: number; limit?: number; sort?: SearchSort; minRating?: number; availableOn?: string; offersOnly?: boolean };

export const TOP_RATED = { minRating: 4.5, minReviews: 3 } as const;

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"] as const;
/** Seuls les profils vérifiés ou en cours de vérification sont publics ; suspendus et refusés sont masqués. */
export const PUBLIC_STATUSES: ("pending" | "verified")[] = ["pending", "verified"];
const DEFAULT_ACCENT = "#F47A45";

function parseSpecialties(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

type ProfileRow = typeof professionalProfiles.$inferSelect;
type ServiceRow = typeof serviceCatalog.$inferSelect;

function toProfessional(profile: ProfileRow, services: ServiceRow[], extras: { rules?: OffpeakRule[]; staff?: StaffMember[] } = {}): CatalogProfessional {
  const active = services.filter((service) => service.professionalId === profile.id && service.isActive === 1);
  const rating = Number(profile.rating);
  const rules = extras.rules ?? [];
  return {
    priceFrom: active.length ? Math.min(...active.map((service) => service.priceXaf)) : 0,
    topRated: rating >= TOP_RATED.minRating && profile.reviewCount >= TOP_RATED.minReviews,
    offpeakMaxPercent: rules.reduce((best, rule) => Math.max(best, rule.percent), 0),
    offpeakRules: rules,
    staff: extras.staff ?? [],
    createdAt: profile.createdAt.toISOString(),
    id: profile.slug,
    slug: profile.slug,
    name: profile.displayName,
    salon: profile.salonName ?? profile.displayName,
    city: profile.city,
    neighborhood: profile.neighborhood ?? "",
    specialties: parseSpecialties(profile.specialties),
    rating: Number(profile.rating),
    reviewCount: profile.reviewCount,
    mode: profile.mode,
    verified: profile.verificationStatus === "verified",
    bio: profile.bio ?? "",
    accent: profile.accentColor ?? DEFAULT_ACCENT,
    timezone: profile.timezone,
    services: services
      .filter((service) => service.professionalId === profile.id && service.isActive === 1)
      .map((service) => ({ id: service.code, name: service.name, duration: service.durationMinutes, preparation: service.preparationMinutes, price: service.priceXaf, category: service.category ?? "" })),
  };
}

async function servicesFor(db: Database, professionalIds: number[]) {
  if (!professionalIds.length) return [];
  return db.select().from(serviceCatalog).where(inArray(serviceCatalog.professionalId, professionalIds)).orderBy(asc(serviceCatalog.priceXaf));
}

/** Score « recommandé » : les Top Rated d’abord, puis la note pondérée par le nombre d’avis. */
const recommendedScore = (pro: CatalogProfessional) => (pro.topRated ? 100 : 0) + pro.rating * Math.log2(2 + pro.reviewCount) + (pro.verified ? 1 : 0);

/** Recherche publique : les professionnels suspendus n’apparaissent jamais. */
export async function searchCatalog(db: Database, input: SearchInput = {}, now = new Date()): Promise<CatalogProfessional[]> {
  const filters = [inArray(professionalProfiles.verificationStatus, PUBLIC_STATUSES)];
  if (input.city && input.city !== "Toutes les villes") filters.push(eq(professionalProfiles.city, input.city));
  if (input.mode === "salon" || input.mode === "domicile") filters.push(inArray(professionalProfiles.mode, [input.mode, "les deux"]));
  const profiles = await db.select().from(professionalProfiles).where(and(...filters)).orderBy(asc(professionalProfiles.displayName));
  const ids = profiles.map((profile) => profile.id);
  const [services, rules] = await Promise.all([servicesFor(db, ids), activeRules(db, ids)]);
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  let list = profiles
    .map((profile) => toProfessional(profile, services, { rules: rules.get(profile.id) }))
    .filter((professional) => {
      if (!professional.services.length) return false;
      const searchable = [professional.name, professional.salon, professional.city, professional.neighborhood, ...professional.specialties, ...professional.services.map((service) => `${service.name} ${service.category}`)].join(" ").toLocaleLowerCase();
      const queryMatch = !query || searchable.includes(query);
      const priceMatch = !input.maxPrice || professional.services.some((service) => service.price <= input.maxPrice!);
      const ratingMatch = !input.minRating || (professional.reviewCount > 0 && professional.rating >= input.minRating);
      const offerMatch = !input.offersOnly || professional.offpeakMaxPercent > 0;
      return queryMatch && priceMatch && ratingMatch && offerMatch;
    });

  // Disponibilité un jour donné : au moins un créneau libre pour la prestation la plus courte.
  if (input.availableOn && /^\d{4}-\d{2}-\d{2}$/.test(input.availableOn)) {
    const checks = await Promise.all(list.map(async (professional) => {
      const shortest = [...professional.services].sort((a, b) => a.duration + a.preparation - (b.duration + b.preparation))[0];
      try {
        const slots = await getFreeSlots(db, { slug: professional.slug, day: input.availableOn!, serviceIds: [shortest.id], now });
        return slots.startsAt.length > 0;
      } catch {
        return false;
      }
    }));
    list = list.filter((_, index) => checks[index]);
  }

  const sort = input.sort ?? "recommended";
  const sorted = [...list].sort((a, b) => {
    if (sort === "rating") return b.rating - a.rating || b.reviewCount - a.reviewCount;
    if (sort === "price_asc") return a.priceFrom - b.priceFrom;
    if (sort === "price_desc") return b.priceFrom - a.priceFrom;
    if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
    return recommendedScore(b) - recommendedScore(a);
  });
  return sorted.slice(0, Math.min(input.limit ?? 50, 100));
}

export async function getProfessional(db: Database, slug: string): Promise<CatalogProfessional | null> {
  const [profile] = await db.select().from(professionalProfiles).where(and(eq(professionalProfiles.slug, slug), inArray(professionalProfiles.verificationStatus, PUBLIC_STATUSES))).limit(1);
  if (!profile) return null;
  const [services, rules, staff] = await Promise.all([servicesFor(db, [profile.id]), activeRules(db, [profile.id]), staffByProfessional(db, [profile.id])]);
  return toProfessional(profile, services, { rules: rules.get(profile.id), staff: staff.get(profile.id) });
}

export async function listCategories(db: Database): Promise<string[]> {
  const rows = await db.select({ category: serviceCatalog.category }).from(serviceCatalog).where(eq(serviceCatalog.isActive, 1));
  return [...new Set(rows.map((row) => row.category).filter((category): category is string => Boolean(category)))].sort((a, b) => a.localeCompare(b, "fr"));
}

/**
 * Créneaux de départ libres, pour une sélection de prestations et un jour donné (heure de Douala), par pas de `stepMinutes`.
 * Un départ est proposé si toute la durée tient dans une plage ouverte, ne touche aucune
 * indisponibilité (bloqué, congé, férié) ni aucune réservation en attente ou confirmée.
 */
export async function getFreeSlots(db: Database, input: { slug: string; day: string; serviceIds: string[]; staffMemberId?: number | null; excludeBookingId?: number; stepMinutes?: number; now?: Date }): Promise<{ durationMinutes: number; occupiedMinutes: number; totalXaf: number; startsAt: string[]; discounts: Record<string, number> }> {
  const selection = await resolveSelection(db, input.slug, input.serviceIds);
  const profile = selection.professional;
  await ensureHorizon(db, profile.id, input.now);
  const dayStart = doualaDateTime(input.day, "00:00");
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const { candidates } = await staffCandidates(db, profile.id, input.staffMemberId);
  const windows = await db.select().from(availabilitySlots).where(and(eq(availabilitySlots.professionalId, profile.id), lt(availabilitySlots.startsAt, dayEnd), gt(availabilitySlots.endsAt, dayStart)));
  const taken = (await db.select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt, staffMemberId: bookings.staffMemberId }).from(bookings).where(and(eq(bookings.professionalId, profile.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]), lt(bookings.startsAt, dayEnd), gt(bookings.endsAt, dayStart))))
    .filter((booking) => booking.id !== input.excludeBookingId);
  const rules = (await activeRules(db, [profile.id])).get(profile.id) ?? [];
  const step = (input.stepMinutes ?? 30) * 60_000;
  const occupiedMinutes = selection.durationMinutes + selection.preparationMinutes;
  const length = occupiedMinutes * 60_000;
  const now = (input.now ?? new Date()).getTime();
  const closures = windows.filter((window) => window.status !== "open").map((item) => [item.startsAt.getTime(), item.endsAt.getTime()] as const);
  const result: string[] = [];
  for (const window of windows.filter((item) => item.status === "open")) {
    for (let start = window.startsAt.getTime(); start + length <= window.endsAt.getTime(); start += step) {
      if (start < dayStart.getTime() || start >= dayEnd.getTime() || start <= now) continue;
      if (closures.some(([from, to]) => overlaps(start, start + length, from, to))) continue;
      if (!freeStaffFor(candidates, taken, start, start + length).length) continue;
      result.push(new Date(start).toISOString());
    }
  }
  const startsAt = [...new Set(result)].sort();
  const discounts: Record<string, number> = {};
  for (const iso of startsAt) {
    const percent = offpeakPercentAt(rules, new Date(iso));
    if (percent) discounts[iso] = percent;
  }
  return { durationMinutes: selection.durationMinutes, occupiedMinutes, totalXaf: selection.totalXaf, startsAt, discounts };
}
