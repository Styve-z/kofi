ALTER TABLE `professional_profiles` ADD `specialties` text;--> statement-breakpoint
ALTER TABLE `professional_profiles` ADD `accentColor` varchar(16);--> statement-breakpoint
ALTER TABLE `service_catalog` ADD `code` varchar(80);--> statement-breakpoint
-- Rétro-remplissage des lignes existantes avant de rendre la colonne obligatoire.
UPDATE `service_catalog` SET `code` = CONCAT('svc-', `id`) WHERE `code` IS NULL;--> statement-breakpoint
ALTER TABLE `service_catalog` MODIFY `code` varchar(80) NOT NULL;--> statement-breakpoint
ALTER TABLE `service_catalog` ADD CONSTRAINT `service_catalog_pro_code_uq` UNIQUE(`professionalId`,`code`);--> statement-breakpoint
CREATE INDEX `availability_pro_starts_idx` ON `availability_slots` (`professionalId`,`startsAt`);--> statement-breakpoint
CREATE INDEX `booking_events_booking_idx` ON `booking_events` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_items_booking_idx` ON `booking_items` (`bookingId`);--> statement-breakpoint
CREATE INDEX `bookings_pro_starts_idx` ON `bookings` (`professionalId`,`startsAt`);--> statement-breakpoint
CREATE INDEX `bookings_customer_idx` ON `bookings` (`customerUserId`);--> statement-breakpoint
CREATE INDEX `professional_profiles_city_idx` ON `professional_profiles` (`city`);