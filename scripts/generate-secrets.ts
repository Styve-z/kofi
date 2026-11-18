/**
 * Génère des secrets forts pour la production (à coller dans les variables d’environnement de l’hébergeur,
 * JAMAIS dans Git). Usage : pnpm exec tsx scripts/generate-secrets.ts
 */
import { randomBytes } from "node:crypto";

const secret = (bytes: number) => randomBytes(bytes).toString("base64url");

console.log(`# Secrets KOFI générés le ${new Date().toISOString()} — à garder dans un coffre-fort de mots de passe`);
console.log(`MANUS_JWT_SECRET=${secret(48)}`);
console.log(`TWO_FACTOR_KEY=${secret(48)}`);
console.log(`PAYMENT_WEBHOOK_SECRET=${secret(32)}`);
console.log(`# Mot de passe de l’utilisateur MySQL dédié (voir documentation/production.md) :`);
console.log(`DB_PASSWORD=${secret(24)}`);
console.log("");
console.log("Attention : changer MANUS_JWT_SECRET déconnecte tout le monde ; changer TWO_FACTOR_KEY oblige les admins à réactiver la double vérification.");
