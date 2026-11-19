import { decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  // Connexion e-mail + mot de passe : empreinte scrypt (jamais le mot de passe en clair). Vide pour les comptes OAuth.
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  // admin = super-administrateur ; moderator et support = équipe KOFI aux droits limités (voir shared/permissions.ts).
  role: mysqlEnum("role", ["user", "support", "moderator", "admin", "superadmin"]).default("user").notNull(),
  // Un compte suspendu ne peut plus utiliser les procédures connectées.
  status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
  // Les sessions ouvertes avant cette date sont refusées (mis à jour quand le mot de passe est réinitialisé).
  sessionsValidAfter: timestamp("sessionsValidAfter"),
  // Adresse e-mail confirmée par le lien reçu : les e-mails de notification ne partent que vers une adresse vérifiée.
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  // Double vérification (application d’authentification, TOTP). Le secret est chiffré (AES-256-GCM).
  twoFactorSecret: varchar("twoFactorSecret", { length: 255 }),
  twoFactorPendingSecret: varchar("twoFactorPendingSecret", { length: 255 }),
  twoFactorEnabledAt: timestamp("twoFactorEnabledAt"),
  // Codes de secours : empreintes JSON ; chacun ne sert qu’une fois.
  twoFactorBackupCodes: text("twoFactorBackupCodes"),
  // Dernier pas de temps accepté : un même code ne peut pas resservir.
  twoFactorLastStep: int("twoFactorLastStep"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const professionalProfiles = mysqlTable("professional_profiles", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("ownerUserId"),
  slug: varchar("slug", { length: 140 }).notNull().unique(),
  displayName: varchar("displayName", { length: 180 }).notNull(),
  salonName: varchar("salonName", { length: 180 }),
  city: varchar("city", { length: 80 }).notNull(),
  neighborhood: varchar("neighborhood", { length: 120 }),
  // Numéro WhatsApp public (format +2376XXXXXXXX), renseigné volontairement par le professionnel.
  whatsappPhone: varchar("whatsappPhone", { length: 20 }),
  // Position du salon (degrés décimaux), pour la carte du profil. Facultative.
  latitude: decimal("latitude", { precision: 9, scale: 6 }),
  longitude: decimal("longitude", { precision: 9, scale: 6 }),
  mode: mysqlEnum("mode", ["salon", "domicile", "les deux"]).default("salon").notNull(),
  bio: text("bio"),
  // Liste JSON de libellés (ex. ["Tresses","Soins"]) ; stockée en texte pour rester compatible MySQL/MariaDB.
  specialties: text("specialties"),
  accentColor: varchar("accentColor", { length: 16 }),
  // Horaires types par jour (JSON : { "1": { "open": "08:00", "close": "18:00" }, … } ; 0 = dimanche).
  // Les plages « open » datées de availability_slots sont générées à partir de ce modèle.
  weeklyHours: text("weeklyHours"),
  verificationStatus: mysqlEnum("verificationStatus", ["pending", "verified", "suspended", "refused"]).default("pending").notNull(),
  // Motif du dernier refus ou de la dernière suspension, visible par l’administration.
  verificationNote: varchar("verificationNote", { length: 255 }),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("0.00").notNull(),
  reviewCount: int("reviewCount").default(0).notNull(),
  timezone: varchar("timezone", { length: 64 }).default("Africa/Douala").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("professional_profiles_city_idx").on(table.city), uniqueIndex("professional_profiles_owner_uq").on(table.ownerUserId)]);

export const serviceCatalog = mysqlTable("service_catalog", {
  id: int("id").autoincrement().primaryKey(),
  professionalId: int("professionalId").notNull(),
  // Identifiant public stable, utilisé par l’API à la place de l’id numérique.
  code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  category: varchar("category", { length: 100 }),
  durationMinutes: int("durationMinutes").notNull(),
  preparationMinutes: int("preparationMinutes").default(0).notNull(),
  priceXaf: int("priceXaf").notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [uniqueIndex("service_catalog_pro_code_uq").on(table.professionalId, table.code)]);

export const availabilitySlots = mysqlTable("availability_slots", {
  id: int("id").autoincrement().primaryKey(),
  professionalId: int("professionalId").notNull(),
  startsAt: timestamp("startsAt").notNull(),
  endsAt: timestamp("endsAt").notNull(),
  status: mysqlEnum("status", ["open", "blocked", "leave", "holiday"]).default("open").notNull(),
  note: varchar("note", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("availability_pro_starts_idx").on(table.professionalId, table.startsAt)]);

export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 40 }).notNull().unique(),
  customerUserId: int("customerUserId"),
  professionalId: int("professionalId").notNull(),
  startsAt: timestamp("startsAt").notNull(),
  endsAt: timestamp("endsAt").notNull(),
  timezone: varchar("timezone", { length: 64 }).default("Africa/Douala").notNull(),
  mode: mysqlEnum("mode", ["salon", "domicile"]).notNull(),
  address: text("address"),
  customerName: varchar("customerName", { length: 180 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 40 }).notNull(),
  notes: text("notes"),
  // Montant des prestations avant remise, remise appliquée, et total à payer (= sous-total − remise).
  subtotalXaf: int("subtotalXaf").default(0).notNull(),
  discountXaf: int("discountXaf").default(0).notNull(),
  promotionId: int("promotionId"),
  totalXaf: int("totalXaf").notNull(),
  // Paiement : « none » tant que rien n’est dû (paiement désactivé ou demande non confirmée).
  paymentStatus: mysqlEnum("paymentStatus", ["none", "unpaid", "paid", "refund_pending", "refunded"]).default("none").notNull(),
  amountDueXaf: int("amountDueXaf").default(0).notNull(),
  amountPaidXaf: int("amountPaidXaf").default(0).notNull(),
  // Commission KOFI figée quand le rendez-vous est terminé (base des reversements au professionnel).
  commissionXaf: int("commissionXaf").default(0).notNull(),
  // Collaborateur choisi (ou attribué automatiquement) quand le salon a déclaré une équipe.
  staffMemberId: int("staffMemberId"),
  // Détail des réductions incluses dans discountXaf : heures creuses et points fidélité.
  offpeakPercent: int("offpeakPercent").default(0).notNull(),
  offpeakDiscountXaf: int("offpeakDiscountXaf").default(0).notNull(),
  loyaltyPointsUsed: int("loyaltyPointsUsed").default(0).notNull(),
  loyaltyDiscountXaf: int("loyaltyDiscountXaf").default(0).notNull(),
  // Part du total réglée par carte cadeau (comptée dans amountPaidXaf, recréditée sur la carte en cas d’annulation).
  giftCardId: int("giftCardId"),
  giftCardXaf: int("giftCardXaf").default(0).notNull(),
  // Points fidélité déjà crédités pour ce rendez-vous (évite un double crédit).
  loyaltyEarned: int("loyaltyEarned").default(0).notNull(),
  // Rappel « la veille » déjà envoyé (une seule fois par rendez-vous et par horaire).
  reminderSentAt: timestamp("reminderSentAt"),
  status: mysqlEnum("status", ["pending", "confirmed", "refused", "cancelled", "completed", "no_show"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("bookings_pro_starts_idx").on(table.professionalId, table.startsAt),
  index("bookings_customer_idx").on(table.customerUserId),
]);

export const bookingItems = mysqlTable("booking_items", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  serviceId: int("serviceId").notNull(),
  serviceName: varchar("serviceName", { length: 180 }).notNull(),
  durationMinutes: int("durationMinutes").notNull(),
  priceXaf: int("priceXaf").notNull(),
}, (table) => [index("booking_items_booking_idx").on(table.bookingId)]);

export const bookingEvents = mysqlTable("booking_events", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  actorUserId: int("actorUserId"),
  fromStatus: varchar("fromStatus", { length: 40 }),
  toStatus: varchar("toStatus", { length: 40 }).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("booking_events_booking_idx").on(table.bookingId)]);

export const portfolioItems = mysqlTable("portfolio_items", {
  id: int("id").autoincrement().primaryKey(),
  professionalId: int("professionalId").notNull(),
  objectKey: varchar("objectKey", { length: 255 }).notNull(),
  stableUrl: varchar("stableUrl", { length: 500 }).notNull(),
  // Miniature légère (affichée en liste) ; l’image principale est réduite à 1200 px.
  thumbKey: varchar("thumbKey", { length: 255 }),
  thumbUrl: varchar("thumbUrl", { length: 500 }),
  width: int("width"),
  height: int("height"),
  moderationNote: varchar("moderationNote", { length: 255 }),
  moderatedByUserId: int("moderatedByUserId"),
  description: text("description"),
  serviceId: int("serviceId"),
  moderationStatus: mysqlEnum("moderationStatus", ["pending", "approved", "rejected", "removed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("portfolio_pro_status_idx").on(table.professionalId, table.moderationStatus)]);

export const promotions = mysqlTable("promotions", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 40 }).notNull().unique(),
  label: varchar("label", { length: 180 }).notNull(),
  discountType: mysqlEnum("discountType", ["fixed", "percentage"]).notNull(),
  discountValue: int("discountValue").notNull(),
  startsAt: timestamp("startsAt").notNull(),
  endsAt: timestamp("endsAt").notNull(),
  isEnabled: int("isEnabled").default(1).notNull(),
  // Nombre maximal de réservations actives utilisant le code (null = illimité).
  maxUses: int("maxUses"),
  onePerCustomer: int("onePerCustomer").default(1).notNull(),
  minSubtotalXaf: int("minSubtotalXaf").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Codes à usage unique pour connecter l’application mobile (échange de type PKCE) :
 * seul le haché du code est stocké ; le code expire au bout de 5 minutes et ne sert qu’une fois.
 */
export const mobileLoginCodes = mysqlTable("mobile_login_codes", {
  id: int("id").autoincrement().primaryKey(),
  codeHash: varchar("codeHash", { length: 64 }).notNull().unique(),
  userId: int("userId").notNull(),
  challenge: varchar("challenge", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Avis vérifiés : un seul par réservation, seulement après un rendez-vous terminé.
 * La note et le nombre d’avis du professionnel sont recalculés à partir des avis visibles.
 */
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull().unique(),
  professionalId: int("professionalId").notNull(),
  customerUserId: int("customerUserId").notNull(),
  rating: int("rating").notNull(),
  comment: text("comment"),
  status: mysqlEnum("status", ["visible", "hidden"]).default("visible").notNull(),
  moderationNote: varchar("moderationNote", { length: 255 }),
  proReply: text("proReply"),
  proRepliedAt: timestamp("proRepliedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("reviews_pro_idx").on(table.professionalId, table.status)]);

/** Notifications affichées dans le site et l’application (base des futurs envois SMS/WhatsApp). */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: varchar("type", { length: 60 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body"),
  link: varchar("link", { length: 255 }),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("notifications_user_idx").on(table.userId, table.readAt)]);

/**
 * Paiements et remboursements Mobile Money. Une ligne par opération chez le prestataire ;
 * `providerReference` est unique : un même événement reçu deux fois ne s’applique qu’une fois.
 */
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  // Un paiement concerne soit une réservation, soit l’achat d’une carte cadeau.
  bookingId: int("bookingId"),
  giftCardId: int("giftCardId"),
  kind: mysqlEnum("kind", ["payment", "refund"]).default("payment").notNull(),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerReference: varchar("providerReference", { length: 120 }).notNull().unique(),
  operator: mysqlEnum("operator", ["mtn", "orange"]),
  payerPhone: varchar("payerPhone", { length: 40 }),
  amountXaf: int("amountXaf").notNull(),
  status: mysqlEnum("status", ["pending", "succeeded", "failed"]).default("pending").notNull(),
  failureReason: varchar("failureReason", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [index("payments_booking_idx").on(table.bookingId), index("payments_status_idx").on(table.status)]);

/** Reversements faits aux professionnels (virement Mobile Money effectué par l’équipe), pour le solde à verser. */
export const payouts = mysqlTable("payouts", {
  id: int("id").autoincrement().primaryKey(),
  professionalId: int("professionalId").notNull(),
  amountXaf: int("amountXaf").notNull(),
  note: varchar("note", { length: 255 }),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("payouts_pro_idx").on(table.professionalId)]);

/** Signalements et réclamations envoyés par les clients, traités par l’équipe KOFI. */
export const reports = mysqlTable("reports", {
  id: int("id").autoincrement().primaryKey(),
  reporterUserId: int("reporterUserId").notNull(),
  bookingId: int("bookingId"),
  professionalId: int("professionalId"),
  category: mysqlEnum("category", ["no_show_pro", "quality", "price", "behavior", "safety", "other"]).notNull(),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "resolved", "rejected"]).default("open").notNull(),
  resolutionNote: text("resolutionNote"),
  handledByUserId: int("handledByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("reports_status_idx").on(table.status), index("reports_reporter_idx").on(table.reporterUserId)]);

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId").notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: varchar("entityId", { length: 80 }).notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Professionnels mis en favoris par les clients. */
export const favorites = mysqlTable("favorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  professionalId: int("professionalId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("favorites_user_pro_uq").on(table.userId, table.professionalId)]);

/** Équipe d’un salon : chaque collaborateur a son propre agenda (rendez-vous en parallèle possibles). */
export const staffMembers = mysqlTable("staff_members", {
  id: int("id").autoincrement().primaryKey(),
  professionalId: int("professionalId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  title: varchar("title", { length: 120 }),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("staff_members_pro_idx").on(table.professionalId)]);

/** Remises « heures creuses » : un pourcentage sur un jour de la semaine et une tranche horaire (heure de Douala). */
export const offpeakRules = mysqlTable("offpeak_rules", {
  id: int("id").autoincrement().primaryKey(),
  professionalId: int("professionalId").notNull(),
  dayOfWeek: int("dayOfWeek").notNull(), // 0 = dimanche … 6 = samedi
  startTime: varchar("startTime", { length: 5 }).notNull(), // « HH:MM »
  endTime: varchar("endTime", { length: 5 }).notNull(),
  percent: int("percent").notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("offpeak_pro_idx").on(table.professionalId)]);

/** Journal des points fidélité : le solde est la somme des lignes (gain positif, utilisation négative). */
export const loyaltyLedger = mysqlTable("loyalty_ledger", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  bookingId: int("bookingId"),
  points: int("points").notNull(),
  reason: varchar("reason", { length: 180 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("loyalty_user_idx").on(table.userId)]);

/** Cartes cadeaux achetées par Mobile Money ; le code n’est révélé qu’une fois le paiement reçu. */
export const giftCards = mysqlTable("gift_cards", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 24 }).notNull().unique(),
  initialXaf: int("initialXaf").notNull(),
  balanceXaf: int("balanceXaf").notNull(),
  purchaserUserId: int("purchaserUserId").notNull(),
  recipientName: varchar("recipientName", { length: 120 }),
  message: varchar("message", { length: 300 }),
  status: mysqlEnum("status", ["pending_payment", "active", "cancelled"]).default("pending_payment").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  activatedAt: timestamp("activatedAt"),
}, (table) => [index("gift_cards_purchaser_idx").on(table.purchaserUserId)]);

/**
 * Liens « mot de passe oublié » : seule l’empreinte SHA-256 du jeton est stockée.
 * Valable 1 h, utilisable une seule fois ; une nouvelle demande annule les liens précédents.
 */
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("password_reset_user_idx").on(table.userId)]);

/** Liens de vérification de l’adresse e-mail (même principe que la réinitialisation : empreinte seule, 48 h, usage unique). */
export const emailVerificationTokens = mysqlTable("email_verification_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("email_verification_user_idx").on(table.userId)]);

/**
 * File d’envoi des e-mails et SMS. Les lignes sont écrites dans la transaction de l’événement
 * (rien ne part pour une action annulée) puis envoyées en arrière-plan, avec nouvelles tentatives.
 */
export const messageOutbox = mysqlTable("message_outbox", {
  id: int("id").autoincrement().primaryKey(),
  channel: mysqlEnum("channel", ["email", "sms"]).notNull(),
  recipient: varchar("recipient", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 200 }),
  body: text("body").notNull(),
  kind: varchar("kind", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["pending", "sending", "sent", "failed"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastError: varchar("lastError", { length: 255 }),
  sendAfter: timestamp("sendAfter").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("message_outbox_status_idx").on(table.status, table.sendAfter)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ProfessionalProfile = typeof professionalProfiles.$inferSelect;
export type ServiceCatalog = typeof serviceCatalog.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;
export type AvailabilitySlot = typeof availabilitySlots.$inferSelect;
