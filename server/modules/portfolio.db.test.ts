/** Photos de réalisations : traitement d’image et modération (base réelle). */
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { professionalProfiles, users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { setStorageForTests, type Storage } from "../storage";
import { openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { listNotifications } from "./notifications";
import { listMyPortfolio, listPublicPortfolio, MAX_PHOTOS, moderatePortfolioItem, processImage, removePortfolioItem, uploadPortfolioImage } from "./portfolio";

const photo = (width = 4000, height = 3000, extra: (image: sharp.Sharp) => sharp.Sharp = (image) => image) =>
  extra(sharp({ create: { width, height, channels: 3, background: { r: 244, g: 122, b: 69 } } })).jpeg().toBuffer();

/** Stockage en mémoire pour les tests. */
function memoryStorage() {
  const files = new Map<string, Buffer>();
  const storage: Storage = { driver: "local", put: async (key, data) => { files.set(key, data); return { key, url: `/uploads/${key}` }; }, remove: async (key) => { files.delete(key); } };
  return { storage, files };
}

describe("traitement des images", () => {
  it("réduit en WebP, crée une miniature et retire les métadonnées (dont le GPS)", async () => {
    const input = await photo(4000, 3000, (image) => image.withExif({ IFD0: { Make: "TestPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "4/1 3/1 0/1" } }));
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const result = await processImage(input);
    const main = await sharp(result.main).metadata();
    expect([main.format, main.width, main.height, main.exif]).toEqual(["webp", 1200, 900, undefined]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([400, 400]);
    expect(result.main.length).toBeLessThan(input.length);
  });

  it("applique l’orientation du téléphone", async () => {
    const portrait = await photo(1600, 1200, (image) => image.withMetadata({ orientation: 6 }));
    const result = await processImage(portrait);
    expect([result.width, result.height]).toEqual([900, 1200]);
  });

  it("refuse ce qui n’est pas une image exploitable", async () => {
    await expect(processImage(Buffer.from("pas une image"))).rejects.toThrow("IMAGE_INVALID");
    await expect(processImage(await photo(100, 100))).rejects.toThrow("IMAGE_INVALID");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"/></svg>');
    await expect(processImage(svg)).rejects.toThrow("IMAGE_INVALID");
    await expect(processImage(Buffer.alloc(9 * 1024 * 1024))).rejects.toThrow("IMAGE_TOO_LARGE");
  });
});

describe.skipIf(!url)("photos et modération (base réelle)", () => {
  let db: Database;
  let pro: User; let other: User; let mod: User; let support: User;
  let memory: ReturnType<typeof memoryStorage>;
  beforeAll(async () => { process.env.DATABASE_URL = url; db = await openTestDb(); }, 60_000);
  afterAll(async () => { setStorageForTests(undefined as unknown as null); await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    memory = memoryStorage();
    setStorageForTests(memory.storage);
    await db.insert(users).values([{ openId: "p1", name: "Cédric", role: "user" }, { openId: "p2", name: "Autre", role: "user" }, { openId: "m1", name: "Modo", role: "moderator" }, { openId: "s1", name: "Support", role: "support" }]);
    const all = await db.select().from(users);
    [pro, other, mod, support] = ["p1", "p2", "m1", "s1"].map((openId) => all.find((user) => user.openId === openId)!);
    await db.update(professionalProfiles).set({ ownerUserId: pro.id }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
    await db.update(professionalProfiles).set({ ownerUserId: other.id }).where(eq(professionalProfiles.slug, "mireille-nkoulou"));
  });

  it("une photo n’est publique qu’après validation, et le pro est prévenu", async () => {
    const { id } = await uploadPortfolioImage(db, pro.id, { data: await photo(), description: "Dégradé + barbe" });
    expect(memory.files.size).toBe(2);
    expect((await listMyPortfolio(db, pro.id)).items).toEqual([expect.objectContaining({ id, status: "pending", description: "Dégradé + barbe", width: 1200 })]);
    expect(await listPublicPortfolio(db, "cedric-mbarga")).toEqual([]);
    await expect(moderatePortfolioItem(db, mod.id, { id, status: "rejected" })).rejects.toThrow("REASON_REQUIRED");
    await moderatePortfolioItem(db, mod.id, { id, status: "approved" });
    expect(await listPublicPortfolio(db, "cedric-mbarga")).toEqual([expect.objectContaining({ id, thumbUrl: expect.stringContaining("-thumb.webp") })]);
    expect((await listNotifications(db, pro.id))[0].title).toContain("publiée");
  });

  it("limite à 12 photos, et seul le propriétaire retire les siennes", async () => {
    const image = await photo(800, 800);
    for (let index = 0; index < MAX_PHOTOS; index++) await uploadPortfolioImage(db, pro.id, { data: image });
    await expect(uploadPortfolioImage(db, pro.id, { data: image })).rejects.toThrow("PORTFOLIO_LIMIT");
    const [first] = (await listMyPortfolio(db, pro.id)).items;
    await expect(removePortfolioItem(db, other.id, first.id)).rejects.toThrow("PORTFOLIO_NOT_FOUND");
    const before = memory.files.size;
    await removePortfolioItem(db, pro.id, first.id);
    expect(memory.files.size).toBe(before - 2);
    await expect(uploadPortfolioImage(db, pro.id, { data: image })).resolves.toMatchObject({ status: "pending" });
    await expect(uploadPortfolioImage(db, support.id, { data: image })).rejects.toThrow("NO_PROFESSIONAL_PROFILE");
  });

  it("seuls modérateurs et super-admins valident ; sans stockage configuré, l’envoi est refusé proprement", async () => {
    const { id } = await uploadPortfolioImage(db, pro.id, { data: await photo(800, 800) });
    const caller = (user: User) => appRouter.createCaller({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
    await expect(caller(support).admin.portfolio.moderate({ id, status: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(support).admin.portfolio.list()).resolves.toMatchObject({ pending: 1 });
    await expect(caller(mod).admin.portfolio.moderate({ id, status: "rejected", note: "Photo floue" })).resolves.toMatchObject({ status: "rejected" });
    setStorageForTests(null);
    await expect(uploadPortfolioImage(db, pro.id, { data: await photo(800, 800) })).rejects.toThrow("STORAGE_UNAVAILABLE");
  });
});
