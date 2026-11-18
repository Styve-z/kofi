/**
 * Change le mot de passe d’un compte existant.
 * Usage : pnpm exec tsx scripts/set-password.ts <email> "<nouveau mot de passe>"
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDatabase } from "../server/db";
import { users } from "../drizzle/schema";
import { hashPassword, normalizeEmail, PASSWORD_MAX, PASSWORD_MIN } from "../server/modules/passwordAuth";

const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('Usage : pnpm exec tsx scripts/set-password.ts <email> "<mot de passe>"'); process.exit(1); }
if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) { console.error(`Le mot de passe doit faire entre ${PASSWORD_MIN} et ${PASSWORD_MAX} caractères.`); process.exit(1); }

async function main() {
  const db = createDatabase(process.env.DATABASE_URL!);
  try {
    const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
    if (!user) { console.error("Aucun compte avec cet e-mail."); process.exitCode = 1; return; }
    await db.update(users).set({ passwordHash: await hashPassword(password), loginMethod: "password" }).where(eq(users.id, user.id));
    console.log(`Mot de passe changé pour ${normalizeEmail(email)} (rôle : ${user.role}).`);
  } finally {
    await db.$pool.end();
  }
}

main().catch((error) => { console.error("Échec :", error); process.exitCode = 1; });
