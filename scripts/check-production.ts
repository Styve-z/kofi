/**
 * Vérifie la configuration avant une mise en production (mêmes règles que le serveur au démarrage).
 * Usage : pnpm exec tsx scripts/check-production.ts            (lit .env)
 *         pnpm exec tsx scripts/check-production.ts prod.env   (lit un autre fichier)
 */
import { config } from "dotenv";
import { checkProductionConfig } from "../server/_core/security";

const file = process.argv[2] ?? ".env";
const parsed = config({ path: file, processEnv: {} }).parsed ?? {};
const issues = checkProductionConfig({ ...parsed, NODE_ENV: "production" });

if (!issues.length) {
  console.log(`✔ ${file} : configuration prête pour la production.`);
} else {
  for (const issue of issues) console.log(`${issue.level === "error" ? "✘ ERREUR   " : "! attention "} ${issue.key} — ${issue.message}`);
  const errors = issues.filter((issue) => issue.level === "error").length;
  console.log(`\n${errors} erreur(s), ${issues.length - errors} avertissement(s). ${errors ? "Le serveur refusera de démarrer en production." : "Le serveur démarrera."}`);
  process.exitCode = errors ? 1 : 0;
}
