/** Avis vérifiés et notifications, contre une vraie base. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, professionalProfiles, users, type User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type { Database } from "../db";
import { appRouter } from "../routers";
import { at, MONDAY, NOW, openTestDb, resetTestDb, TEST_DATABASE_URL as url } from "../test/dbSetup";
import { setProfessionalStatus, transitionBooking } from "./admin";
import { cancelBooking, createBooking, getBookingsForUser, type CreateBookingInput } from "./booking";
import { getProfessional } from "./catalog";
import { listNotifications, markRead, unreadCount } from "./notifications";
import { transitionMyBooking } from "./pro";
import { updateReport, createReport } from "./reports";
import { createReview, displayName, listMyProfessionalReviews, listPublicReviews, replyToReview, setReviewStatus } from "./reviews";
import { doualaDateTime } from "./time";

describe("displayName", () => {
  it("n’affiche que le prénom et l’initiale", () => {
    expect(displayName("Amina Njoya")).toBe("Amina N.");
    expect(displayName("Esther Ngo Bassa")).toBe("Esther B.");
    expect(displayName(null)).toBe("Client KOFI");
  });
});

describe.skipIf(!url)("avis et notifications (base réelle)", () => {
  let db: Database;
  let client: User; let other: User; let pro: User; let admin: User;
  const AFTER = doualaDateTime(MONDAY, "12:00");

  beforeAll(async () => { process.env.DATABASE_URL = url; db = await openTestDb(); }, 60_000);
  afterAll(async () => { await db?.$pool.end(); });
  beforeEach(async () => {
    await resetTestDb(db);
    await db.insert(users).values([{ openId: "c1", name: "Amina Njoya", role: "user" }, { openId: "c2", name: "Paul Etoundi", role: "user" }, { openId: "p1", name: "Cédric Mbarga", role: "user" }, { openId: "a1", name: "Admin", role: "admin" }]);
    const all = await db.select().from(users);
    [client, other, pro, admin] = ["c1", "c2", "p1", "a1"].map((openId) => all.find((user) => user.openId === openId)!);
    await db.update(professionalProfiles).set({ ownerUserId: pro.id }).where(eq(professionalProfiles.slug, "cedric-mbarga"));
  });
  const booking = (overrides: Partial<CreateBookingInput> = {}): CreateBookingInput => ({ customerUserId: client.id, professionalSlug: "cedric-mbarga", startsAt: at(MONDAY, "10:00"), durationMinutes: 50, timezone: "Africa/Douala", mode: "salon", customerName: "Amina Njoya", customerPhone: "690000001", serviceIds: ["cedric-fade"], totalXaf: 7000, ...overrides });

  async function completed(overrides: Partial<CreateBookingInput> = {}) {
    const created = await createBooking(db, booking(overrides), NOW);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
    await transitionMyBooking(db, pro.id, { reference: created.reference, to: "completed" }, AFTER);
    return created;
  }

  describe("avis", () => {
    it("n’est possible qu’après un rendez-vous terminé, par son client, une seule fois", async () => {
      const pending = await createBooking(db, booking({ startsAt: at(MONDAY, "15:00") }), NOW);
      await expect(createReview(db, client.id, { reference: pending.reference, rating: 5 }, AFTER)).rejects.toThrow("REVIEW_NOT_ALLOWED");
      const done = await completed();
      expect((await getBookingsForUser(db, client.id)).find((item) => item.reference === done.reference)).toMatchObject({ canReview: true, review: null });
      await expect(createReview(db, other.id, { reference: done.reference, rating: 1 }, AFTER)).rejects.toThrow("BOOKING_NOT_FOUND");
      await expect(createReview(db, client.id, { reference: done.reference, rating: 6 }, AFTER)).rejects.toThrow("REVIEW_INVALID");
      await createReview(db, client.id, { reference: done.reference, rating: 4, comment: "Dégradé net, accueil chaleureux." }, AFTER);
      await expect(createReview(db, client.id, { reference: done.reference, rating: 5 }, AFTER)).rejects.toThrow("REVIEW_EXISTS");
      expect((await getBookingsForUser(db, client.id)).find((item) => item.reference === done.reference)).toMatchObject({ canReview: false, review: { rating: 4 } });
      // La note publique devient la vraie moyenne (les valeurs de démonstration sont remplacées).
      expect(await getProfessional(db, "cedric-mbarga")).toMatchObject({ rating: 4, reviewCount: 1 });
      expect(await listPublicReviews(db, "cedric-mbarga")).toEqual([expect.objectContaining({ rating: 4, author: "Amina N.", comment: "Dégradé net, accueil chaleureux." })]);
    });

    it("expire 30 jours après le rendez-vous", async () => {
      const done = await completed();
      await expect(createReview(db, client.id, { reference: done.reference, rating: 5 }, doualaDateTime("2030-06-10", "10:00"))).rejects.toThrow("REVIEW_NOT_ALLOWED");
    });

    it("le pro répond une fois ; l’équipe masque un avis et la note est recalculée", async () => {
      const first = await completed();
      const second = await completed({ customerUserId: other.id, customerName: "Paul Etoundi", startsAt: at(MONDAY, "11:00") });
      await createReview(db, client.id, { reference: first.reference, rating: 5 }, AFTER);
      await createReview(db, other.id, { reference: second.reference, rating: 1, comment: "Propos injurieux…" }, AFTER);
      expect(await getProfessional(db, "cedric-mbarga")).toMatchObject({ rating: 3, reviewCount: 2 });
      const [latest] = await listMyProfessionalReviews(db, pro.id);
      await replyToReview(db, pro.id, { id: latest.id, reply: "Merci pour votre retour, nous restons à votre écoute." });
      await expect(replyToReview(db, pro.id, { id: latest.id, reply: "Encore" })).rejects.toThrow("REVIEW_ALREADY_ANSWERED");
      await expect(replyToReview(db, client.id, { id: latest.id, reply: "Usurpation" })).rejects.toThrow("NO_PROFESSIONAL_PROFILE");
      await expect(setReviewStatus(db, admin.id, { id: latest.id, status: "hidden" })).rejects.toThrow("REASON_REQUIRED");
      await setReviewStatus(db, admin.id, { id: latest.id, status: "hidden", note: "Propos injurieux" });
      expect(await getProfessional(db, "cedric-mbarga")).toMatchObject({ rating: 5, reviewCount: 1 });
      expect((await listPublicReviews(db, "cedric-mbarga")).map((review) => review.rating)).toEqual([5]);
      const support = (await db.select().from(users).where(eq(users.id, admin.id)))[0];
      await expect(appRouter.createCaller({ user: { ...support, role: "support" }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] }).admin.reviews.setStatus({ id: latest.id, status: "visible" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("notifications", () => {
    it("préviennent le pro et le client à chaque étape, et ne concernent que leur destinataire", async () => {
      const created = await createBooking(db, booking(), NOW);
      expect((await listNotifications(db, pro.id))[0]).toMatchObject({ type: "booking.created", title: "Nouvelle demande de rendez-vous", read: false });
      expect((await listNotifications(db, pro.id))[0].body).toContain("lun. 6 mai à 10:00");
      await transitionMyBooking(db, pro.id, { reference: created.reference, to: "confirmed" }, NOW);
      expect((await listNotifications(db, client.id))[0]).toMatchObject({ type: "booking.confirmed", title: "Rendez-vous confirmé", link: "/mes-reservations" });
      await transitionMyBooking(db, pro.id, { reference: created.reference, to: "completed" }, AFTER);
      expect((await listNotifications(db, client.id))[0].title).toContain("donnez votre avis");
      await createReview(db, client.id, { reference: created.reference, rating: 5 }, AFTER);
      expect((await listNotifications(db, pro.id))[0]).toMatchObject({ type: "review.created", title: "Nouvel avis : 5/5" });

      const other1 = await createBooking(db, booking({ startsAt: at(MONDAY, "15:00") }), NOW);
      await cancelBooking(db, other1.reference, client.id);
      expect((await listNotifications(db, pro.id))[0].type).toBe("booking.cancelled_by_client");
      const other2 = await createBooking(db, booking({ startsAt: at(MONDAY, "16:00") }), NOW);
      await transitionBooking(db, admin.id, { reference: other2.reference, to: "cancelled", note: "Client injoignable" });
      expect((await listNotifications(db, client.id))[0]).toMatchObject({ type: "booking.cancelled", body: expect.stringContaining("Client injoignable") });
      expect((await listNotifications(db, pro.id))[0].type).toBe("booking.admin_cancelled");

      expect(await unreadCount(db, client.id)).toBe(3);
      const [first] = await listNotifications(db, client.id);
      expect(await markRead(db, other.id, first.id)).toEqual({ unread: 0 });
      expect(await unreadCount(db, client.id)).toBe(3);
      expect(await markRead(db, client.id, first.id)).toEqual({ unread: 2 });
      expect(await markRead(db, client.id)).toEqual({ unread: 0 });
    });

    it("préviennent le pro de sa validation et le client de la réponse à son signalement", async () => {
      await db.update(professionalProfiles).set({ ownerUserId: other.id }).where(eq(professionalProfiles.slug, "sandra-essomba"));
      await setProfessionalStatus(db, admin.id, { slug: "sandra-essomba", action: "validate" });
      expect((await listNotifications(db, other.id))[0].title).toContain("vérifié");
      const { id } = await createReport(db, client.id, { category: "other", message: "Question sur une réservation passée." });
      await updateReport(db, admin.id, { id, status: "resolved", note: "Réponse envoyée par téléphone." });
      expect((await listNotifications(db, client.id))[0]).toMatchObject({ type: "report.resolved", body: "Réponse envoyée par téléphone." });
    });

    it("un rendez-vous sans compte pro rattaché ne génère pas d’erreur", async () => {
      await expect(createBooking(db, booking({ professionalSlug: "mireille-nkoulou", serviceIds: ["mireille-coupe"], durationMinutes: 60, totalXaf: 8000 }), NOW)).resolves.toBeTruthy();
      const rows = await db.select().from(bookings);
      expect(rows).toHaveLength(1);
    });
  });
});
