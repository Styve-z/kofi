import { relations } from "drizzle-orm";
import { auditLogs, availabilitySlots, bookingEvents, bookingItems, bookings, portfolioItems, professionalProfiles, promotions, serviceCatalog, users } from "./schema";

export const professionalRelations = relations(professionalProfiles, ({ many }) => ({ services: many(serviceCatalog), availability: many(availabilitySlots), bookings: many(bookings), portfolio: many(portfolioItems) }));
export const serviceRelations = relations(serviceCatalog, ({ one, many }) => ({ professional: one(professionalProfiles, { fields: [serviceCatalog.professionalId], references: [professionalProfiles.id] }), bookingItems: many(bookingItems) }));
export const bookingRelations = relations(bookings, ({ one, many }) => ({ professional: one(professionalProfiles, { fields: [bookings.professionalId], references: [professionalProfiles.id] }), customer: one(users, { fields: [bookings.customerUserId], references: [users.id] }), items: many(bookingItems), events: many(bookingEvents) }));
export const bookingItemRelations = relations(bookingItems, ({ one }) => ({ booking: one(bookings, { fields: [bookingItems.bookingId], references: [bookings.id] }), service: one(serviceCatalog, { fields: [bookingItems.serviceId], references: [serviceCatalog.id] }) }));
export const bookingEventRelations = relations(bookingEvents, ({ one }) => ({ booking: one(bookings, { fields: [bookingEvents.bookingId], references: [bookings.id] }), actor: one(users, { fields: [bookingEvents.actorUserId], references: [users.id] }) }));
export const availabilityRelations = relations(availabilitySlots, ({ one }) => ({ professional: one(professionalProfiles, { fields: [availabilitySlots.professionalId], references: [professionalProfiles.id] }) }));
export const portfolioRelations = relations(portfolioItems, ({ one }) => ({ professional: one(professionalProfiles, { fields: [portfolioItems.professionalId], references: [professionalProfiles.id] }), service: one(serviceCatalog, { fields: [portfolioItems.serviceId], references: [serviceCatalog.id] }) }));
export const auditRelations = relations(auditLogs, ({ one }) => ({ actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }) }));
export const userRelations = relations(users, ({ many }) => ({ bookings: many(bookings), auditLogs: many(auditLogs) }));
export const promotionRelations = relations(promotions, () => ({}));
