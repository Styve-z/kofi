/**
 * Niveaux de l’équipe KOFI. Le serveur applique ces règles sur chaque procédure ;
 * l’interface s’en sert seulement pour masquer ce qui n’est pas autorisé.
 *  - support    : aide aux clients (réservations, signalements), lecture du reste ;
 *  - moderator  : qualité du catalogue (professionnels, suspensions), signalements ;
 *  - admin      : administrateur, tous les droits du back-office ; peut nommer support et modérateurs ;
 *  - superadmin : propriétaire de la plateforme. Seul à nommer ou retirer des administrateurs,
 *                 seul à ouvrir /superadmin. Ce rôle ne s’attribue jamais depuis l’interface
 *                 (uniquement par le script serveur scripts/create-accounts.ts) et ne peut être ni modifié ni suspendu.
 */
export type Role = "user" | "support" | "moderator" | "admin" | "superadmin";
export type StaffRole = Exclude<Role, "user">;

const ALL = ["support", "moderator", "admin", "superadmin"] as const;

export const PERMISSIONS = {
  "overview.read": ALL,
  "bookings.read": ALL,
  "bookings.manage": ["support", "admin", "superadmin"],
  "professionals.read": ALL,
  "professionals.manage": ["moderator", "admin", "superadmin"],
  "users.read": ALL,
  "users.suspend": ["moderator", "admin", "superadmin"],
  "users.roles": ["admin", "superadmin"],
  "reports.read": ALL,
  "reports.manage": ALL,
  "promotions.read": ["support", "admin", "superadmin"],
  "promotions.manage": ["admin", "superadmin"],
  "audit.read": ALL,
  "reviews.read": ALL,
  "reviews.manage": ["moderator", "admin", "superadmin"],
  "portfolio.read": ALL,
  "portfolio.moderate": ["moderator", "admin", "superadmin"],
  "payments.read": ["support", "admin", "superadmin"],
  "payments.manage": ["admin", "superadmin"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const isStaff = (role: string | null | undefined): role is StaffRole => (ALL as readonly string[]).includes(role ?? "");

export const isSuperAdmin = (role: string | null | undefined) => role === "superadmin";

export const can = (role: string | null | undefined, permission: Permission) =>
  isStaff(role) && (PERMISSIONS[permission] as readonly string[]).includes(role);

/** Rôles qu’un compte peut attribuer à un autre (jamais « superadmin »). */
export const assignableRoles = (actorRole: string | null | undefined): Role[] =>
  actorRole === "superadmin" ? ["user", "support", "moderator", "admin"] : actorRole === "admin" ? ["user", "support", "moderator"] : [];

/** Un compte peut-il modifier (rôle, suspension) un autre compte ? Les administrateurs ne touchent ni aux administrateurs ni au super-administrateur. */
export const canManageAccount = (actorRole: string | null | undefined, targetRole: string | null | undefined) =>
  targetRole !== "superadmin" && (targetRole !== "admin" || actorRole === "superadmin");

export const ROLE_LABELS: Record<Role, string> = { user: "Client", support: "Support", moderator: "Modérateur", admin: "Administrateur", superadmin: "Super-administrateur" };
