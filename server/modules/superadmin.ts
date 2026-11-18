import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { bookings, professionalProfiles, users } from "../../drizzle/schema";
import { ROLE_LABELS, type Role } from "@shared/permissions";
import type { Database } from "../db";
import { audit } from "./admin";
import { BusinessError } from "./errors";
import { hashPassword, normalizeEmail, PASSWORD_MAX } from "./passwordAuth";

/**
 * Espace super-administrateur (/superadmin) : gestion de l’équipe KOFI.
 * Toutes les fonctions sont appelées derrière superAdminProcedure (rôle « superadmin » vérifié à chaque requête).
 */

export const SUPERADMIN_PASSWORD_MIN = 12;
const TEAM_ROLES = ["support", "moderator", "admin", "superadmin"] as const;

export async function getPlatformSummary(db: Database) {
  const [roleCounts, [pros], [bookingStats]] = await Promise.all([
    db.select({ role: users.role, count: sql<number>`count(*)` }).from(users).groupBy(users.role),
    db.select({ total: sql<number>`count(*)`, verified: sql<number>`sum(case when ${professionalProfiles.verificationStatus} = 'verified' then 1 else 0 end)` }).from(professionalProfiles),
    db.select({ total: sql<number>`count(*)` }).from(bookings),
  ]);
  const byRole = Object.fromEntries(roleCounts.map((row) => [row.role, Number(row.count)])) as Partial<Record<Role, number>>;
  return {
    clients: byRole.user ?? 0,
    team: TEAM_ROLES.reduce((sum, role) => sum + (byRole[role] ?? 0), 0),
    admins: (byRole.admin ?? 0),
    professionals: Number(pros?.total ?? 0),
    verifiedProfessionals: Number(pros?.verified ?? 0),
    bookings: Number(bookingStats?.total ?? 0),
  };
}

export async function listTeam(db: Database) {
  const rows = await db.select().from(users).where(inArray(users.role, [...TEAM_ROLES])).orderBy(desc(users.createdAt));
  return rows.map((row) => ({
    id: row.id, name: row.name ?? "Sans nom", email: row.email, role: row.role, status: row.status,
    loginMethod: row.loginMethod, createdAt: row.createdAt.toISOString(), lastSignedIn: row.lastSignedIn.toISOString(),
  }));
}

/** Crée un compte d’équipe (support, modérateur ou administrateur) avec e-mail + mot de passe. */
export async function createTeamAccount(db: Database, actorUserId: number, input: { name: string; email: string; password: string; role: "support" | "moderator" | "admin" }) {
  const email = normalizeEmail(input.email);
  if (input.password.length < SUPERADMIN_PASSWORD_MIN || input.password.length > PASSWORD_MAX) throw new BusinessError("PASSWORD_WEAK");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new BusinessError("EMAIL_TAKEN");
  const name = input.name.trim();
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.insert(users).values({ openId: `pwd_${randomUUID().replace(/-/g, "")}`, name, email, passwordHash, loginMethod: "password", role: input.role });
    const [created] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    await audit(tx, actorUserId, "Compte d’équipe créé", "user", String(created.id), { name, note: ROLE_LABELS[input.role] });
    return { id: created.id, role: input.role };
  });
}
