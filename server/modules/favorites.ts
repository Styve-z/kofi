import { and, desc, eq, inArray } from "drizzle-orm";
import { favorites, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { getProfessional, PUBLIC_STATUSES } from "./catalog";
import { BusinessError } from "./errors";

/** Favoris : un client garde ses professionnels préférés. Les profils masqués n’apparaissent plus. */
export async function favoriteSlugs(db: Database, userId: number) {
  const rows = await db.select({ slug: professionalProfiles.slug }).from(favorites).innerJoin(professionalProfiles, eq(professionalProfiles.id, favorites.professionalId)).where(eq(favorites.userId, userId));
  return rows.map((row) => row.slug);
}

export async function toggleFavorite(db: Database, userId: number, slug: string) {
  const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(and(eq(professionalProfiles.slug, slug), inArray(professionalProfiles.verificationStatus, PUBLIC_STATUSES))).limit(1);
  if (!profile) throw new BusinessError("PROFESSIONAL_NOT_FOUND");
  const [existing] = await db.select({ id: favorites.id }).from(favorites).where(and(eq(favorites.userId, userId), eq(favorites.professionalId, profile.id))).limit(1);
  if (existing) {
    await db.delete(favorites).where(eq(favorites.id, existing.id));
    return { favorite: false };
  }
  await db.insert(favorites).values({ userId, professionalId: profile.id }).onDuplicateKeyUpdate({ set: { userId } });
  return { favorite: true };
}

export async function listFavorites(db: Database, userId: number) {
  const rows = await db.select({ slug: professionalProfiles.slug }).from(favorites).innerJoin(professionalProfiles, eq(professionalProfiles.id, favorites.professionalId)).where(eq(favorites.userId, userId)).orderBy(desc(favorites.createdAt));
  const list = await Promise.all(rows.map((row) => getProfessional(db, row.slug)));
  return list.filter((item): item is NonNullable<typeof item> => Boolean(item));
}
