import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
  bookings, emailVerificationTokens, favorites, giftCards, loyaltyLedger, messageOutbox, mobileLoginCodes, notifications,
  passwordResetTokens, professionalProfiles, reviews, users, type User,
} from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { verifyPassword } from "./passwordAuth";

/**
 * Droits de l’utilisateur sur ses données :
 *  - exportMyData : copie lisible (JSON) de tout ce que KOFI garde sur le compte ;
 *  - deleteMyAccount : suppression à la demande. Les rendez-vous passés et les paiements sont
 *    conservés pour la comptabilité et les litiges, mais ANONYMISÉS (nom, téléphone, adresse, notes effacés).
 * Les comptes de l’équipe KOFI ne se suppriment pas ici : le super-administrateur les retire.
 */

export async function exportMyData(db: Database, userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new BusinessError("USER_NOT_FOUND");
  const [myBookings, myReviews, myFavorites, myLoyalty, myGiftCards, myNotifications, [profile]] = await Promise.all([
    db.select().from(bookings).where(eq(bookings.customerUserId, userId)).orderBy(desc(bookings.startsAt)),
    db.select().from(reviews).where(eq(reviews.customerUserId, userId)),
    db.select({ professional: professionalProfiles.displayName, slug: professionalProfiles.slug, since: favorites.createdAt }).from(favorites).innerJoin(professionalProfiles, eq(professionalProfiles.id, favorites.professionalId)).where(eq(favorites.userId, userId)),
    db.select().from(loyaltyLedger).where(eq(loyaltyLedger.userId, userId)),
    db.select().from(giftCards).where(eq(giftCards.purchaserUserId, userId)),
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.id)).limit(500),
    db.select().from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, emailVerified: Boolean(user.emailVerifiedAt), twoFactorEnabled: Boolean(user.twoFactorEnabledAt), createdAt: user.createdAt, lastSignedIn: user.lastSignedIn },
    bookings: myBookings.map((row) => ({ reference: row.reference, startsAt: row.startsAt, status: row.status, totalXaf: row.totalXaf, paidXaf: row.amountPaidXaf, customerName: row.customerName, customerPhone: row.customerPhone, address: row.address, notes: row.notes, createdAt: row.createdAt })),
    reviews: myReviews.map((row) => ({ rating: row.rating, comment: row.comment, createdAt: row.createdAt })),
    favorites: myFavorites,
    loyalty: myLoyalty.map((row) => ({ points: row.points, reason: row.reason, at: row.createdAt })),
    giftCards: myGiftCards.map((row) => ({ code: row.status === "active" ? row.code : null, initialXaf: row.initialXaf, balanceXaf: row.balanceXaf, status: row.status, expiresAt: row.expiresAt })),
    notifications: myNotifications.map((row) => ({ title: row.title, body: row.body, at: row.createdAt })),
    professionalProfile: profile ? { slug: profile.slug, displayName: profile.displayName, salonName: profile.salonName, city: profile.city, neighborhood: profile.neighborhood, bio: profile.bio, status: profile.verificationStatus } : null,
  };
}

export async function deleteMyAccount(db: Database, user: User, input: { password: string; confirm: string }, now = new Date()) {
  if (user.role !== "user") throw new BusinessError("ACCOUNT_PROTECTED");
  if (input.confirm.trim().toUpperCase() !== "SUPPRIMER") throw new BusinessError("DELETE_CONFIRM_REQUIRED");
  if (user.passwordHash && !(await verifyPassword(input.password, user.passwordHash))) throw new BusinessError("INVALID_CREDENTIALS");

  const [profile] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, user.id)).limit(1);
  // Rendez-vous à venir (comme client ou comme pro) : à annuler d’abord, pour ne laisser personne sans nouvelles.
  const upcoming = await db.select({ id: bookings.id }).from(bookings).where(and(
    inArray(bookings.status, ["pending", "confirmed"]), gt(bookings.startsAt, now),
    profile ? or(eq(bookings.customerUserId, user.id), eq(bookings.professionalId, profile.id)) : eq(bookings.customerUserId, user.id),
  )).limit(1);
  if (upcoming.length) throw new BusinessError("ACCOUNT_HAS_UPCOMING_BOOKINGS");

  await db.transaction(async (tx) => {
    await tx.update(bookings).set({ customerName: "Client supprimé", customerPhone: "supprimé", address: null, notes: null }).where(eq(bookings.customerUserId, user.id));
    await tx.delete(favorites).where(eq(favorites.userId, user.id));
    await tx.delete(notifications).where(eq(notifications.userId, user.id));
    await tx.delete(loyaltyLedger).where(eq(loyaltyLedger.userId, user.id));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id));
    await tx.delete(mobileLoginCodes).where(eq(mobileLoginCodes.userId, user.id));
    if (user.email) await tx.delete(messageOutbox).where(and(eq(messageOutbox.recipient, user.email.toLowerCase()), eq(messageOutbox.status, "pending")));
    // Profil pro : retiré du catalogue et détaché du compte (l’historique des rendez-vous reste cohérent).
    if (profile) await tx.update(professionalProfiles).set({ ownerUserId: null, verificationStatus: "suspended", verificationNote: "Compte du professionnel supprimé à sa demande" }).where(eq(professionalProfiles.id, profile.id));
    await tx.update(users).set({
      openId: `deleted_${user.id}_${randomUUID().slice(0, 8)}`, name: "Compte supprimé", email: null, passwordHash: null, loginMethod: null,
      status: "suspended", emailVerifiedAt: null, sessionsValidAfter: new Date(Math.floor(now.getTime() / 1000) * 1000 + 1000),
      twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorEnabledAt: null, twoFactorBackupCodes: null, twoFactorLastStep: null,
    }).where(eq(users.id, user.id));
  });
  return { deleted: true as const };
}
