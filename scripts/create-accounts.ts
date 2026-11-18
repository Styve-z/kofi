/**
 * Crée les comptes de base de KOFI : super-administrateur, administrateur, client et professionnel.
 * Usage : pnpm exec tsx scripts/create-accounts.ts            (crée les comptes manquants)
 *         pnpm exec tsx scripts/create-accounts.ts --reset    (régénère aussi les mots de passe existants)
 *
 * Les mots de passe sont tirés au hasard et écrits UNIQUEMENT dans COMPTES-KOFI.local.md (à la racine),
 * fichier à garder pour soi. Le rôle « superadmin » ne peut être attribué que par ce script.
 */
import "dotenv/config";
import { randomInt, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { createDatabase } from "../server/db";
import { professionalProfiles, users } from "../drizzle/schema";
import { hashPassword } from "../server/modules/passwordAuth";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL manquant."); process.exit(1); }
if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Refusé en production sans --force : utilisez des e-mails réels et changez les mots de passe ensuite.");
  process.exit(1);
}
const reset = process.argv.includes("--reset");

type Account = { key: string; label: string; name: string; email: string; role: "superadmin" | "admin" | "user"; length: number; home: string };
const ACCOUNTS: Account[] = [
  { key: "superadmin", label: "Super-administrateur", name: "Super Admin KOFI", email: "superadmin@kofi.test", role: "superadmin", length: 24, home: "/superadmin" },
  { key: "admin", label: "Administrateur", name: "Admin KOFI", email: "admin@kofi.test", role: "admin", length: 16, home: "/admin" },
  { key: "client", label: "Client", name: "Client Démo", email: "client@kofi.test", role: "user", length: 12, home: "/mes-reservations" },
  { key: "pro", label: "Professionnel (coiffeur)", name: "Cédric Mbarga", email: "pro@kofi.test", role: "user", length: 12, home: "/professionnel" },
];
const PRO_SLUG = "cedric-mbarga";

function generatePassword(length: number) {
  // Sans caractères ambigus (0/O, 1/l/I) ; au moins une minuscule, une majuscule, un chiffre et un symbole.
  const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#%*-_=+?"];
  const all = sets.join("");
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

async function main() {
  const db = createDatabase(url!);
  const lines: string[] = [];
  try {
    for (const account of ACCOUNTS) {
      const [existing] = await db.select().from(users).where(eq(users.email, account.email)).limit(1);
      let password: string | null = null;
      let userId: number;
      if (!existing) {
        password = generatePassword(account.length);
        await db.insert(users).values({ openId: `pwd_${randomUUID().replace(/-/g, "")}`, name: account.name, email: account.email, passwordHash: await hashPassword(password), loginMethod: "password", role: account.role });
        const [created] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
        userId = created.id;
        console.log(`Créé : ${account.label} (${account.email})`);
      } else {
        userId = existing.id;
        const changes: Partial<typeof users.$inferInsert> = { role: account.role, status: "active" };
        if (reset) { password = generatePassword(account.length); changes.passwordHash = await hashPassword(password); changes.loginMethod = "password"; }
        await db.update(users).set(changes).where(eq(users.id, existing.id));
        console.log(`Déjà présent : ${account.label} (${account.email})${reset ? " — mot de passe régénéré" : ""}`);
      }
      if (account.key === "pro") {
        const [owned] = await db.select({ slug: professionalProfiles.slug }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
        if (!owned) {
          const linked = await db.update(professionalProfiles).set({ ownerUserId: userId }).where(and(eq(professionalProfiles.slug, PRO_SLUG), isNull(professionalProfiles.ownerUserId)));
          console.log((linked[0] as { affectedRows?: number }).affectedRows ? `  Profil « ${PRO_SLUG} » relié au compte pro.` : `  Le profil « ${PRO_SLUG} » a déjà un propriétaire : le compte pro pourra créer son salon depuis /professionnel.`);
        }
      }
      lines.push(`| ${account.label} | \`${account.email}\` | ${password ? `\`${password}\`` : "_inchangé (relancer avec --reset)_"} | ${account.home} |`);
    }
  } finally {
    await db.$pool.end();
  }
  const file = [
    "# Comptes KOFI (local)",
    "",
    "> Fichier PRIVÉ : ne le partagez pas, ne l’envoyez pas en ligne. Changez ces mots de passe avant toute mise en production.",
    "",
    `Généré le ${new Date().toLocaleString("fr-FR", { timeZone: "Africa/Douala" })} (heure de Douala).`,
    "",
    "| Compte | Identifiant | Mot de passe | Page d’arrivée |",
    "| --- | --- | --- | --- |",
    ...lines,
    "",
    "- **Super-administrateur** : se connecte sur http://localhost:3000/superadmin (ou /connexion, il y est redirigé). Session de 12 h.",
    "- **Administrateur** : back-office http://localhost:3000/admin. Ne peut ni nommer d’administrateur ni toucher au super-administrateur.",
    "- **Client** : réservations, favoris, fidélité, cartes cadeaux.",
    "- **Professionnel** : espace pro http://localhost:3000/professionnel (salon de démonstration « Cédric Mbarga »).",
    "",
  ].join("\n");
  writeFileSync("COMPTES-KOFI.local.md", file, "utf8");
  console.log("Identifiants écrits dans COMPTES-KOFI.local.md");
}

main().catch((error) => { console.error("Échec :", error); process.exitCode = 1; });
