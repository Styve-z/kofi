import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import sharp from "sharp";
import { auditLogs, portfolioItems, professionalProfiles } from "../../drizzle/schema";
import type { Database } from "../db";
import { getStorage } from "../storage";
import { BusinessError } from "./errors";
import { notify } from "./notifications";

/**
 * Photos de réalisations. Chaque envoi est vérifié (vraie image, 25 Mpx au plus), réorienté,
 * débarrassé de ses métadonnées (dont la position GPS du téléphone), puis réduit en WebP :
 * une image de 1200 px et une miniature de 400 px, légères pour les petits forfaits.
 * Une photo n’est publique qu’après validation par un modérateur.
 */

export const MAX_PHOTOS = 12;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED = new Set(["jpeg", "png", "webp", "heif"]);

async function ownedProfile(db: Pick<Database, "select">, userId: number) {
  const [profile] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
  return profile;
}

/** Transforme l’image envoyée en deux WebP sans métadonnées. */
export async function processImage(input: Buffer) {
  if (input.length > MAX_UPLOAD_BYTES) throw new BusinessError("IMAGE_TOO_LARGE");
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: 25_000_000 }).metadata();
  } catch {
    throw new BusinessError("IMAGE_INVALID");
  }
  if (!metadata.format || !ACCEPTED.has(metadata.format) || !metadata.width || !metadata.height) throw new BusinessError("IMAGE_INVALID");
  if (metadata.width < 300 || metadata.height < 300) throw new BusinessError("IMAGE_INVALID");
  try {
    // rotate() applique l’orientation EXIF ; sharp ne recopie aucune métadonnée par défaut.
    const main = await sharp(input, { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    const thumb = await sharp(input, { limitInputPixels: 25_000_000 }).rotate().resize({ width: 400, height: 400, fit: "cover" }).webp({ quality: 70 }).toBuffer();
    return { main: main.data, width: main.info.width, height: main.info.height, thumb };
  } catch {
    throw new BusinessError("IMAGE_INVALID");
  }
}

export async function uploadPortfolioImage(db: Database, userId: number, input: { data: Buffer; description?: string }) {
  const storage = getStorage();
  if (!storage) throw new BusinessError("STORAGE_UNAVAILABLE");
  const profile = await ownedProfile(db, userId);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(portfolioItems).where(and(eq(portfolioItems.professionalId, profile.id), ne(portfolioItems.moderationStatus, "removed")));
  if (Number(count) >= MAX_PHOTOS) throw new BusinessError("PORTFOLIO_LIMIT");
  const image = await processImage(input.data);
  const id = randomBytes(10).toString("hex");
  const base = `portfolio/${profile.slug}/${id}`;
  const main = await storage.put(`${base}.webp`, image.main, "image/webp");
  const thumb = await storage.put(`${base}-thumb.webp`, image.thumb, "image/webp");
  const description = input.description?.trim().slice(0, 300) || null;
  const [inserted] = await db.insert(portfolioItems).values({ professionalId: profile.id, objectKey: main.key, stableUrl: main.url, thumbKey: thumb.key, thumbUrl: thumb.url, width: image.width, height: image.height, description, moderationStatus: "pending" }).$returningId();
  return { id: inserted.id, status: "pending" as const };
}

const view = (row: typeof portfolioItems.$inferSelect) => ({
  id: row.id, url: row.stableUrl, thumbUrl: row.thumbUrl ?? row.stableUrl, width: row.width, height: row.height,
  description: row.description, status: row.moderationStatus, moderationNote: row.moderationNote, createdAt: row.createdAt.toISOString(),
});

export async function listMyPortfolio(db: Database, userId: number) {
  const profile = await ownedProfile(db, userId);
  const rows = await db.select().from(portfolioItems).where(and(eq(portfolioItems.professionalId, profile.id), ne(portfolioItems.moderationStatus, "removed"))).orderBy(desc(portfolioItems.id));
  return { max: MAX_PHOTOS, items: rows.map(view) };
}

/** Retirer une photo : fichiers supprimés du stockage, ligne conservée comme « retirée ». */
export async function removePortfolioItem(db: Database, userId: number, id: number) {
  const profile = await ownedProfile(db, userId);
  const [row] = await db.select().from(portfolioItems).where(and(eq(portfolioItems.id, id), eq(portfolioItems.professionalId, profile.id), ne(portfolioItems.moderationStatus, "removed"))).limit(1);
  if (!row) throw new BusinessError("PORTFOLIO_NOT_FOUND");
  await db.update(portfolioItems).set({ moderationStatus: "removed" }).where(eq(portfolioItems.id, row.id));
  const storage = getStorage();
  if (storage) { await storage.remove(row.objectKey); if (row.thumbKey) await storage.remove(row.thumbKey); }
  return { id };
}

export async function listPublicPortfolio(db: Database, slug: string) {
  const [profile] = await db.select({ id: professionalProfiles.id, status: professionalProfiles.verificationStatus }).from(professionalProfiles).where(eq(professionalProfiles.slug, slug)).limit(1);
  if (!profile || (profile.status !== "pending" && profile.status !== "verified")) return [];
  const rows = await db.select().from(portfolioItems).where(and(eq(portfolioItems.professionalId, profile.id), eq(portfolioItems.moderationStatus, "approved"))).orderBy(desc(portfolioItems.id)).limit(MAX_PHOTOS);
  return rows.map((row) => ({ id: row.id, url: row.stableUrl, thumbUrl: row.thumbUrl ?? row.stableUrl, width: row.width, height: row.height, description: row.description }));
}

export async function listPortfolioForModeration(db: Database, input: { status?: "pending" | "approved" | "rejected" } = {}) {
  const status = input.status ?? "pending";
  const rows = await db.select().from(portfolioItems).where(eq(portfolioItems.moderationStatus, status)).orderBy(status === "pending" ? asc(portfolioItems.id) : desc(portfolioItems.id)).limit(200);
  const pros = rows.length ? await db.select({ id: professionalProfiles.id, name: professionalProfiles.displayName, slug: professionalProfiles.slug }).from(professionalProfiles).where(inArray(professionalProfiles.id, [...new Set(rows.map((row) => row.professionalId))])) : [];
  const [counts] = await db.select({ pending: sql<number>`sum(${portfolioItems.moderationStatus} = 'pending')` }).from(portfolioItems);
  return { pending: Number(counts.pending ?? 0), items: rows.map((row) => ({ ...view(row), professional: pros.find((pro) => pro.id === row.professionalId) ?? null })) };
}

export async function moderatePortfolioItem(db: Database, actorUserId: number, input: { id: number; status: "approved" | "rejected"; note?: string }) {
  const note = input.note?.trim() || null;
  if (input.status === "rejected" && (!note || note.length < 3)) throw new BusinessError("REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(portfolioItems).where(eq(portfolioItems.id, input.id)).limit(1).for("update");
    if (!row || row.moderationStatus === "removed") throw new BusinessError("PORTFOLIO_NOT_FOUND");
    if (row.moderationStatus === input.status) throw new BusinessError("INVALID_TRANSITION");
    await tx.update(portfolioItems).set({ moderationStatus: input.status, moderationNote: note, moderatedByUserId: actorUserId }).where(eq(portfolioItems.id, row.id));
    const [pro] = await tx.select({ name: professionalProfiles.displayName, ownerUserId: professionalProfiles.ownerUserId }).from(professionalProfiles).where(eq(professionalProfiles.id, row.professionalId)).limit(1);
    await tx.insert(auditLogs).values({ actorUserId, action: input.status === "approved" ? "Photo approuvée" : "Photo refusée", entityType: "portfolio", entityId: String(row.id), metadata: JSON.stringify({ name: `Photo de ${pro?.name ?? "?"}`, reason: note }) });
    await notify(tx, { userId: pro?.ownerUserId, type: `portfolio.${input.status}`, title: input.status === "approved" ? "Votre photo est publiée sur votre profil" : "Une photo n’a pas été acceptée", body: note, link: "/professionnel" });
    return { id: row.id, status: input.status };
  });
}
