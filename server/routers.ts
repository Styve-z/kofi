import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { loginWithPassword, PASSWORD_MAX, PASSWORD_MIN, registerWithPassword } from "./modules/passwordAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, staffProcedure, superAdminProcedure } from "./_core/trpc";
import { createTeamAccount, getPlatformSummary, listTeam, SUPERADMIN_PASSWORD_MIN } from "./modules/superadmin";
import { checkResetToken, requestPasswordReset, resetPassword } from "./modules/passwordReset";
import { publicUser, resendVerificationEmail, sendVerificationEmail, verifyEmail } from "./modules/emailVerification";
import { can, PERMISSIONS, type Permission } from "@shared/permissions";
import { getDb, type Database } from "./db";
import { cancelBooking, createBooking, getBookingsForUser, rescheduleBooking, rescheduleSlots } from "./modules/booking";
import { favoriteSlugs, listFavorites, toggleFavorite } from "./modules/favorites";
import { getMyLoyalty } from "./modules/loyalty";
import { checkGiftCard, getGiftCardPayment, GIFT_CARD, listMyGiftCards, purchaseGiftCard } from "./modules/giftcards";
import { simulateGiftCardTestPayment } from "./modules/payments/index";
import { listMyStaff, saveStaffMember, setStaffActive } from "./modules/staff";
import { addOffpeakRule, listMyOffpeak, removeOffpeakRule } from "./modules/offpeak";import { getFreeSlots, getProfessional, listCategories, searchCatalog } from "./modules/catalog";
import { BusinessError, toTrpcError } from "./modules/errors";
import type { WeeklyHours } from "./modules/schedule";
import { addClosure, applyAsProfessional, getMyOverview, getMyProfessional, listClosures, listMyBookings, removeClosure, saveService, setServiceActive, setWeeklyHours, transitionMyBooking, updateMyProfile } from "./modules/pro";
import { createPromotion, getOverview, listAudit, listBookings, listProfessionals, listUsers, setProfessionalStatus, setPromotionEnabled, setUserRole, setUserStatus, transitionBooking } from "./modules/admin";
import { evaluatePromo, listPromotions } from "./modules/promo";
import { createMobileLoginCode, exchangeMobileLoginCode, isAllowedRedirect } from "./modules/mobileAuth";
import { listMyPortfolio, listPortfolioForModeration, listPublicPortfolio, moderatePortfolioItem, removePortfolioItem } from "./modules/portfolio";
import { getPaymentSettings } from "./modules/payments/config";
import { getMyEarnings, getPaymentForCustomer, initiatePayment, listPaymentsForStaff, recordPayout, simulateTestOperation, simulateTestPayment } from "./modules/payments/index";
import { listNotifications, markRead, unreadCount } from "./modules/notifications";
import { createReview, listMyProfessionalReviews, listPublicReviews, listReviewsForStaff, replyToReview, setReviewStatus } from "./modules/reviews";
import { createReport, listMyReports, listReports, updateReport } from "./modules/reports";
import { resolveSelection } from "./modules/booking";

/** Exécute une opération métier avec la base ; toute erreur sort en erreur tRPC typée. */
async function withDb<T>(operation: (db: Database) => Promise<T>): Promise<T> {
  try {
    const db = await getDb();
    if (!db) throw new BusinessError("DATABASE_UNAVAILABLE");
    return await operation(db);
  } catch (error) {
    throw toTrpcError(error);
  }
}

const slug = z.string().trim().min(1).max(140);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : AAAA-MM-JJ");
const bookingStatus = z.enum(["pending", "confirmed", "refused", "cancelled", "completed", "no_show"]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const profileInput = z.object({
  displayName: z.string().trim().min(2).max(180), salonName: z.string().trim().max(180).optional(), city: z.string().trim().min(2).max(80),
  neighborhood: z.string().trim().max(120).optional(), mode: z.enum(["salon", "domicile", "les deux"]), bio: z.string().trim().max(1000).optional(),
  specialties: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});
const reportCategory = z.enum(["no_show_pro", "quality", "price", "behavior", "safety", "other"]);
const reportStatus = z.enum(["open", "in_progress", "resolved", "rejected"]);
const serviceIds = z.array(z.string().trim().min(1).max(80)).min(1).max(10);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => publicUser(opts.ctx.user)),
    /** Inscription e-mail + mot de passe : crée le compte et ouvre directement la session. */
    register: publicProcedure
      .input(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(320), password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX) }))
      .mutation(({ ctx, input }) => withDb(async (db) => {
        const { token, userId } = await registerWithPassword(db, input);
        ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
        await sendVerificationEmail(db, userId);
        return { success: true } as const;
      })),
    login: publicProcedure
      .input(z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(PASSWORD_MAX) }))
      .mutation(({ ctx, input }) => withDb(async (db) => {
        const { token, role, maxAge } = await loginWithPassword(db, { ...input, ip: ctx.req.ip });
        ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge });
        // Le super-administrateur arrive directement sur son espace.
        return { success: true, home: role === "superadmin" ? "/superadmin" : null } as const;
      })),
    /** Mot de passe oublié : répond toujours « envoyé », que le compte existe ou non. */
    requestPasswordReset: publicProcedure
      .input(z.object({ email: z.string().trim().email().max(320) }))
      .mutation(({ ctx, input }) => withDb((db) => requestPasswordReset(db, { email: input.email, ip: ctx.req.ip }))),
    /** Vérification de l’adresse e-mail (lien reçu à l’inscription). */
    verifyEmail: publicProcedure.input(z.object({ token: z.string().max(100) })).mutation(({ input }) => withDb((db) => verifyEmail(db, input.token))),
    resendVerification: protectedProcedure.mutation(({ ctx }) => withDb((db) => resendVerificationEmail(db, ctx.user))),
    checkResetToken: publicProcedure.input(z.object({ token: z.string().max(100) })).query(({ input }) => withDb((db) => checkResetToken(db, input.token))),
    resetPassword: publicProcedure
      .input(z.object({ token: z.string().max(100), password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX) }))
      .mutation(({ input }) => withDb((db) => resetPassword(db, input))),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  catalog: router({
    search: publicProcedure
      .input(z.object({
        query: z.string().max(120).optional(), city: z.string().max(80).optional(), mode: z.string().max(20).optional(), maxPrice: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).optional(),
        sort: z.enum(["recommended", "rating", "price_asc", "price_desc", "newest"]).optional(), minRating: z.number().min(0).max(5).optional(), availableOn: day.optional(), offersOnly: z.boolean().optional(),
      }).optional())
      .query(({ input }) => withDb((db) => searchCatalog(db, input ?? {}))),
    professional: publicProcedure.input(z.object({ slug })).query(({ input }) => withDb((db) => getProfessional(db, input.slug))),
    categories: publicProcedure.query(() => withDb((db) => listCategories(db))),
    portfolio: publicProcedure.input(z.object({ slug })).query(({ input }) => withDb((db) => listPublicPortfolio(db, input.slug))),
    reviews: publicProcedure.input(z.object({ slug, limit: z.number().int().min(1).max(50).optional() })).query(({ input }) => withDb((db) => listPublicReviews(db, input.slug, input.limit))),
    slots: publicProcedure
      .input(z.object({ slug, day, serviceIds, staffMemberId: z.number().int().positive().nullable().optional() }))
      .query(({ input }) => withDb((db) => getFreeSlots(db, input))),
  }),
  payments: router({
    /** Réglages publics : l’interface affiche ou masque le paiement selon ce qui est configuré. */
    config: publicProcedure.query(() => { const settings = getPaymentSettings(); return { enabled: settings.enabled, testMode: settings.testMode, mode: settings.mode, depositPercent: settings.depositPercent, freeCancelHours: settings.freeCancelHours }; }),
    initiate: protectedProcedure.input(z.object({ reference: z.string().trim().min(1).max(40), operator: z.enum(["mtn", "orange"]), phone: z.string().trim().min(8).max(40) })).mutation(({ ctx, input }) => withDb((db) => initiatePayment(db, ctx.user.id, input))),
    status: protectedProcedure.input(z.object({ paymentId: z.number().int().positive() })).query(({ ctx, input }) => withDb((db) => getPaymentForCustomer(db, ctx.user.id, input.paymentId))),
    simulate: protectedProcedure.input(z.object({ paymentId: z.number().int().positive(), outcome: z.enum(["succeeded", "failed"]) })).mutation(({ ctx, input }) => withDb((db) => simulateTestPayment(db, ctx.user.id, input))),
  }),
  promo: router({
    /** Aperçu de la remise pour une sélection, avant d’envoyer la demande (le serveur revérifie à la création). */
    check: protectedProcedure
      .input(z.object({ code: z.string().trim().min(1).max(20), slug, serviceIds }))
      .query(({ ctx, input }) => withDb(async (db) => {
        const selection = await resolveSelection(db, input.slug, input.serviceIds);
        try {
          const result = await evaluatePromo(db, { code: input.code, subtotalXaf: selection.totalXaf, customerUserId: ctx.user.id });
          return { valid: true as const, code: result.code, label: result.label, subtotalXaf: selection.totalXaf, discountXaf: result.discountXaf, totalXaf: result.totalXaf };
        } catch (error) {
          // Un code refusé est une réponse normale, pas une erreur : l’interface affiche la raison.
          if (error instanceof BusinessError && error.code.startsWith("PROMO_")) return { valid: false as const, reason: error.code };
          throw error;
        }
      })),
  }),
  booking: router({
    mine: protectedProcedure.query(({ ctx }) => withDb((db) => getBookingsForUser(db, ctx.user.id))),
    create: protectedProcedure
      .input(z.object({
        professionalSlug: slug,
        startsAt: z.string().datetime({ offset: true }),
        durationMinutes: z.number().int().positive().max(24 * 60),
        timezone: z.string().max(64).default("Africa/Douala"),
        mode: z.enum(["salon", "domicile"]),
        customerName: z.string().trim().min(2).max(180),
        customerPhone: z.string().trim().min(8).max(40),
        address: z.string().trim().max(500).optional(),
        serviceIds,
        totalXaf: z.number().int().nonnegative(),
        notes: z.string().max(1000).optional(),
        promoCode: z.string().trim().max(20).optional(),
        staffMemberId: z.number().int().positive().nullable().optional(),
        loyaltyPoints: z.number().int().min(0).max(1_000_000).optional(),
        giftCardCode: z.string().trim().max(24).optional(),
      }))
      .mutation(({ ctx, input }) => withDb((db) => createBooking(db, { ...input, customerUserId: ctx.user.id }))),
    cancel: protectedProcedure.input(z.object({ reference: z.string().trim().min(1).max(40) })).mutation(({ ctx, input }) => withDb((db) => cancelBooking(db, input.reference, ctx.user.id))),
    rescheduleSlots: protectedProcedure
      .input(z.object({ reference: z.string().trim().min(1).max(40), day, staffMemberId: z.number().int().positive().nullable().optional() }))
      .query(({ ctx, input }) => withDb((db) => rescheduleSlots(db, { ...input, customerUserId: ctx.user.id }))),
    reschedule: protectedProcedure
      .input(z.object({ reference: z.string().trim().min(1).max(40), startsAt: z.string().datetime({ offset: true }), staffMemberId: z.number().int().positive().nullable().optional() }))
      .mutation(({ ctx, input }) => withDb((db) => rescheduleBooking(db, { ...input, customerUserId: ctx.user.id }))),
  }),
  favorites: router({
    ids: protectedProcedure.query(({ ctx }) => withDb((db) => favoriteSlugs(db, ctx.user.id))),
    list: protectedProcedure.query(({ ctx }) => withDb((db) => listFavorites(db, ctx.user.id))),
    toggle: protectedProcedure.input(z.object({ slug })).mutation(({ ctx, input }) => withDb((db) => toggleFavorite(db, ctx.user.id, input.slug))),
  }),
  loyalty: router({
    mine: protectedProcedure.query(({ ctx }) => withDb((db) => getMyLoyalty(db, ctx.user.id))),
  }),
  giftCards: router({
    config: publicProcedure.query(() => ({ ...GIFT_CARD, enabled: getPaymentSettings().enabled, testMode: getPaymentSettings().testMode })),
    mine: protectedProcedure.query(({ ctx }) => withDb((db) => listMyGiftCards(db, ctx.user.id))),
    check: protectedProcedure.input(z.object({ code: z.string().trim().min(4).max(24) })).query(({ input }) => withDb((db) => checkGiftCard(db, input.code))),
    purchase: protectedProcedure
      .input(z.object({ amountXaf: z.number().int(), recipientName: z.string().trim().max(120).optional(), message: z.string().trim().max(300).optional(), operator: z.enum(["mtn", "orange"]), phone: z.string().trim().min(8).max(40) }))
      .mutation(({ ctx, input }) => withDb((db) => purchaseGiftCard(db, ctx.user.id, input))),
    paymentStatus: protectedProcedure.input(z.object({ paymentId: z.number().int().positive() })).query(({ ctx, input }) => withDb((db) => getGiftCardPayment(db, ctx.user.id, input.paymentId))),
    simulate: protectedProcedure.input(z.object({ paymentId: z.number().int().positive(), outcome: z.enum(["succeeded", "failed"]) })).mutation(({ ctx, input }) => withDb((db) => simulateGiftCardTestPayment(db, ctx.user.id, input))),
  }),
  pro: router({
    me: protectedProcedure.query(({ ctx }) => withDb((db) => getMyProfessional(db, ctx.user.id))),
    register: protectedProcedure.input(profileInput).mutation(({ ctx, input }) => withDb((db) => applyAsProfessional(db, ctx.user.id, input))),
    updateProfile: protectedProcedure.input(profileInput).mutation(({ ctx, input }) => withDb((db) => updateMyProfile(db, ctx.user.id, input))),
    overview: protectedProcedure.query(({ ctx }) => withDb((db) => getMyOverview(db, ctx.user.id))),
    saveService: protectedProcedure
      .input(z.object({ id: z.string().max(80).optional(), name: z.string().trim().min(2).max(180), category: z.string().trim().max(100).optional(), durationMinutes: z.number().int(), preparationMinutes: z.number().int().optional(), priceXaf: z.number().int() }))
      .mutation(({ ctx, input }) => withDb((db) => saveService(db, ctx.user.id, input))),
    setServiceActive: protectedProcedure.input(z.object({ id: z.string().min(1).max(80), active: z.boolean() })).mutation(({ ctx, input }) => withDb((db) => setServiceActive(db, ctx.user.id, input))),
    setWeeklyHours: protectedProcedure
      .input(z.record(z.string().regex(/^[0-6]$/), z.object({ open: hhmm, close: hhmm })))
      .mutation(({ ctx, input }) => withDb((db) => setWeeklyHours(db, ctx.user.id, input as WeeklyHours))),
    closures: protectedProcedure.query(({ ctx }) => withDb((db) => listClosures(db, ctx.user.id))),
    addClosure: protectedProcedure
      .input(z.object({ startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), status: z.enum(["blocked", "leave", "holiday"]), note: z.string().max(255).optional() }))
      .mutation(({ ctx, input }) => withDb((db) => addClosure(db, ctx.user.id, input))),
    removeClosure: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => withDb((db) => removeClosure(db, ctx.user.id, input.id))),
    bookings: protectedProcedure.input(z.object({ scope: z.enum(["pending", "upcoming", "past"]) })).query(({ ctx, input }) => withDb((db) => listMyBookings(db, ctx.user.id, input))),
    transition: protectedProcedure
      .input(z.object({ reference: z.string().trim().min(1).max(40), to: bookingStatus, note: z.string().max(500).optional() }))
      .mutation(({ ctx, input }) => withDb((db) => transitionMyBooking(db, ctx.user.id, input))),
    reviews: protectedProcedure.query(({ ctx }) => withDb((db) => listMyProfessionalReviews(db, ctx.user.id))),
    portfolio: protectedProcedure.query(({ ctx }) => withDb((db) => listMyPortfolio(db, ctx.user.id))),
    earnings: protectedProcedure.query(({ ctx }) => withDb((db) => getMyEarnings(db, ctx.user.id))),
    removePhoto: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => withDb((db) => removePortfolioItem(db, ctx.user.id, input.id))),
    replyReview: protectedProcedure.input(z.object({ id: z.number().int().positive(), reply: z.string().max(1000) })).mutation(({ ctx, input }) => withDb((db) => replyToReview(db, ctx.user.id, input))),
    staff: protectedProcedure.query(({ ctx }) => withDb((db) => listMyStaff(db, ctx.user.id))),
    saveStaff: protectedProcedure.input(z.object({ id: z.number().int().positive().optional(), name: z.string().trim().min(2).max(120), title: z.string().trim().max(120).optional() })).mutation(({ ctx, input }) => withDb((db) => saveStaffMember(db, ctx.user.id, input))),
    setStaffActive: protectedProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean() })).mutation(({ ctx, input }) => withDb((db) => setStaffActive(db, ctx.user.id, input))),
    offpeak: protectedProcedure.query(({ ctx }) => withDb((db) => listMyOffpeak(db, ctx.user.id))),
    addOffpeak: protectedProcedure.input(z.object({ dayOfWeek: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm, percent: z.number().int().min(5).max(50) })).mutation(({ ctx, input }) => withDb((db) => addOffpeakRule(db, ctx.user.id, input))),
    removeOffpeak: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => withDb((db) => removeOffpeakRule(db, ctx.user.id, input.id))),
  }),
  mobile: router({
    /** Étape 2 : depuis le site, l’utilisateur connecté crée un code pour son application. */
    createLoginCode: protectedProcedure
      .input(z.object({ challenge: z.string().length(43), redirect: z.string().max(200) }))
      .mutation(({ ctx, input }) => withDb(async (db) => {
        if (!isAllowedRedirect(input.redirect)) throw new BusinessError("MOBILE_LOGIN_INVALID");
        const { code } = await createMobileLoginCode(db, ctx.user.id, input.challenge);
        const separator = input.redirect.includes("?") ? "&" : "?";
        return { redirectUrl: `${input.redirect}${separator}code=${encodeURIComponent(code)}` };
      })),
    /** Étape 3 : l’application échange le code et son secret contre un jeton de session. */
    exchange: publicProcedure
      .input(z.object({ code: z.string().min(20).max(100), verifier: z.string().length(43) }))
      .mutation(({ input }) => withDb((db) => exchangeMobileLoginCode(db, input))),
  }),
  reviews: router({
    create: protectedProcedure
      .input(z.object({ reference: z.string().trim().min(1).max(40), rating: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }))
      .mutation(({ ctx, input }) => withDb((db) => createReview(db, ctx.user.id, input))),
  }),
  notifications: router({
    list: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ ctx, input }) => withDb((db) => listNotifications(db, ctx.user.id, input?.limit))),
    unreadCount: protectedProcedure.query(({ ctx }) => withDb((db) => unreadCount(db, ctx.user.id))),
    markRead: protectedProcedure.input(z.object({ id: z.number().int().positive().optional() }).optional()).mutation(({ ctx, input }) => withDb((db) => markRead(db, ctx.user.id, input?.id))),
  }),
  reports: router({
    create: protectedProcedure
      .input(z.object({ bookingReference: z.string().trim().max(40).optional(), category: reportCategory, message: z.string().trim().min(10).max(2000) }))
      .mutation(({ ctx, input }) => withDb((db) => createReport(db, ctx.user.id, input))),
    mine: protectedProcedure.query(({ ctx }) => withDb((db) => listMyReports(db, ctx.user.id))),
  }),
  admin: router({
    /** Ce que l’interface doit afficher pour le compte connecté (le serveur revérifie chaque appel). */
    me: staffProcedure("overview.read").query(({ ctx }) => ({ role: ctx.user.role, permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => can(ctx.user.role, permission)) })),
    overview: staffProcedure("overview.read").query(() => withDb((db) => getOverview(db))),
    professionals: router({
      list: staffProcedure("professionals.read")
        .input(z.object({ status: z.enum(["pending", "verified", "suspended", "refused"]).optional(), query: z.string().max(120).optional() }).optional())
        .query(({ input }) => withDb((db) => listProfessionals(db, input ?? {}))),
      setStatus: staffProcedure("professionals.manage")
        .input(z.object({ slug, action: z.enum(["validate", "refuse", "suspend", "reactivate"]), reason: z.string().max(255).optional() }))
        .mutation(({ ctx, input }) => withDb((db) => setProfessionalStatus(db, ctx.user.id, input))),
    }),
    bookings: router({
      list: staffProcedure("bookings.read")
        .input(z.object({ status: bookingStatus.optional(), query: z.string().max(120).optional(), limit: z.number().int().min(1).max(200).optional() }).optional())
        .query(({ input }) => withDb((db) => listBookings(db, input ?? {}))),
      transition: staffProcedure("bookings.manage")
        .input(z.object({ reference: z.string().trim().min(1).max(40), to: bookingStatus, note: z.string().max(500).optional() }))
        .mutation(({ ctx, input }) => withDb((db) => transitionBooking(db, ctx.user.id, input))),
    }),
    users: router({
      list: staffProcedure("users.read")
        .input(z.object({ query: z.string().max(120).optional(), role: z.enum(["user", "support", "moderator", "admin", "superadmin", "staff"]).optional(), status: z.enum(["active", "suspended"]).optional() }).optional())
        .query(({ input }) => withDb((db) => listUsers(db, input ?? {}))),
      setStatus: staffProcedure("users.suspend")
        .input(z.object({ userId: z.number().int().positive(), status: z.enum(["active", "suspended"]), reason: z.string().max(255).optional() }))
        .mutation(({ ctx, input }) => withDb((db) => setUserStatus(db, ctx.user.id, input, ctx.user.role))),
      setRole: staffProcedure("users.roles")
        .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "support", "moderator", "admin"]) }))
        .mutation(({ ctx, input }) => withDb((db) => setUserRole(db, ctx.user.id, input, ctx.user.role))),
    }),
    reports: router({
      list: staffProcedure("reports.read").input(z.object({ status: reportStatus.optional() }).optional()).query(({ input }) => withDb((db) => listReports(db, input ?? {}))),
      update: staffProcedure("reports.manage")
        .input(z.object({ id: z.number().int().positive(), status: reportStatus, note: z.string().max(1000).optional() }))
        .mutation(({ ctx, input }) => withDb((db) => updateReport(db, ctx.user.id, input))),
    }),
    promotions: router({
      list: staffProcedure("promotions.read").query(() => withDb((db) => listPromotions(db))),
      create: staffProcedure("promotions.manage")
        .input(z.object({ code: z.string().max(20), label: z.string().max(180), discountType: z.enum(["fixed", "percentage"]), discountValue: z.number().int(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), maxUses: z.number().int().positive().nullable().optional(), onePerCustomer: z.boolean(), minSubtotalXaf: z.number().int().nonnegative().optional() }))
        .mutation(({ ctx, input }) => withDb((db) => createPromotion(db, ctx.user.id, input))),
      setEnabled: staffProcedure("promotions.manage").input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(({ ctx, input }) => withDb((db) => setPromotionEnabled(db, ctx.user.id, input))),
    }),
    reviews: router({
      list: staffProcedure("reviews.read").input(z.object({ status: z.enum(["visible", "hidden"]).optional() }).optional()).query(({ input }) => withDb((db) => listReviewsForStaff(db, input ?? {}))),
      setStatus: staffProcedure("reviews.manage").input(z.object({ id: z.number().int().positive(), status: z.enum(["visible", "hidden"]), note: z.string().max(255).optional() })).mutation(({ ctx, input }) => withDb((db) => setReviewStatus(db, ctx.user.id, input))),
    }),
    portfolio: router({
      list: staffProcedure("portfolio.read").input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).optional()).query(({ input }) => withDb((db) => listPortfolioForModeration(db, input ?? {}))),
      moderate: staffProcedure("portfolio.moderate").input(z.object({ id: z.number().int().positive(), status: z.enum(["approved", "rejected"]), note: z.string().max(255).optional() })).mutation(({ ctx, input }) => withDb((db) => moderatePortfolioItem(db, ctx.user.id, input))),
    }),
    payments: router({
      list: staffProcedure("payments.read").input(z.object({ status: z.enum(["pending", "succeeded", "failed"]).optional(), kind: z.enum(["payment", "refund"]).optional() }).optional()).query(({ input }) => withDb((db) => listPaymentsForStaff(db, input ?? {}))),
      simulate: staffProcedure("payments.manage").input(z.object({ paymentId: z.number().int().positive(), outcome: z.enum(["succeeded", "failed"]) })).mutation(({ ctx, input }) => withDb((db) => simulateTestOperation(db, ctx.user.id, input))),
      recordPayout: staffProcedure("payments.manage").input(z.object({ slug, amountXaf: z.number().int().positive(), note: z.string().max(255).optional() })).mutation(({ ctx, input }) => withDb((db) => recordPayout(db, ctx.user.id, input))),
    }),
    audit: staffProcedure("audit.read").input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional()).query(({ input }) => withDb((db) => listAudit(db, input ?? {}))),
  }),
  /** Espace /superadmin : chaque appel revérifie le rôle « superadmin ». */
  superadmin: router({
    summary: superAdminProcedure.query(() => withDb((db) => getPlatformSummary(db))),
    team: superAdminProcedure.query(() => withDb((db) => listTeam(db))),
    createAccount: superAdminProcedure
      .input(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(320), password: z.string().min(SUPERADMIN_PASSWORD_MIN).max(PASSWORD_MAX), role: z.enum(["support", "moderator", "admin"]) }))
      .mutation(({ ctx, input }) => withDb((db) => createTeamAccount(db, ctx.user.id, input))),
    setRole: superAdminProcedure
      .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "support", "moderator", "admin"]) }))
      .mutation(({ ctx, input }) => withDb((db) => setUserRole(db, ctx.user.id, input, ctx.user.role))),
    setStatus: superAdminProcedure
      .input(z.object({ userId: z.number().int().positive(), status: z.enum(["active", "suspended"]), reason: z.string().max(255).optional() }))
      .mutation(({ ctx, input }) => withDb((db) => setUserStatus(db, ctx.user.id, input, ctx.user.role))),
    audit: superAdminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional()).query(({ input }) => withDb((db) => listAudit(db, input ?? {}))),
  }),
});

export type AppRouter = typeof appRouter;
