/**
 * Charge le catalogue de DÉMONSTRATION dans la base pointée par DATABASE_URL.
 * Usage : pnpm db:seed
 * Refuse de tourner en production sauf avec --force (et après sauvegarde).
 */
import "dotenv/config";
import { createDatabase } from "../server/db";
import { seedDemo } from "../server/modules/demoSeed";
import { eq } from "drizzle-orm";
import { offpeakRules, professionalProfiles, staffMembers } from "../drizzle/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Seed de démonstration refusé en production. Ajoutez --force seulement si vous savez ce que vous faites.");
  process.exit(1);
}

/** Exemples d’équipe et d’offres heures creuses (ajoutés une seule fois) pour montrer ces fonctionnalités. */
async function seedExtras(db: ReturnType<typeof createDatabase>) {
  const pros = await db.select().from(professionalProfiles);
  const bySlug = (slug: string) => pros.find((pro) => pro.slug === slug);
  const cedric = bySlug("cedric-mbarga");
  const mireille = bySlug("mireille-nkoulou");
  if (cedric && !(await db.select().from(staffMembers).where(eq(staffMembers.professionalId, cedric.id))).length) {
    await db.insert(staffMembers).values([{ professionalId: cedric.id, name: "Cédric", title: "Barbier, fondateur" }, { professionalId: cedric.id, name: "Junior", title: "Barbier" }]);
  }
  if (cedric && !(await db.select().from(offpeakRules).where(eq(offpeakRules.professionalId, cedric.id))).length) {
    await db.insert(offpeakRules).values([2, 3, 4].map((dayOfWeek) => ({ professionalId: cedric.id, dayOfWeek, startTime: "09:00", endTime: "12:00", percent: 20 })));
  }
  if (mireille && !(await db.select().from(offpeakRules).where(eq(offpeakRules.professionalId, mireille.id))).length) {
    await db.insert(offpeakRules).values({ professionalId: mireille.id, dayOfWeek: 1, startTime: "09:00", endTime: "13:00", percent: 15 });
  }
}

const db = createDatabase(url);
seedDemo(db)
  .then(async (result) => { await seedExtras(db); return result; })
  .then((result) => console.log(`Seed terminé : ${result.professionals} professionnels, ${result.services} prestations, ${result.openingDays} journées d’ouverture.`))
  .catch((error) => { console.error("Échec du seed :", error); process.exitCode = 1; })
  .finally(() => db.$pool.end());
