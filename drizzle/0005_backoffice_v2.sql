CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reporterUserId` int NOT NULL,
	`bookingId` int,
	`professionalId` int,
	`category` enum('no_show_pro','quality','price','behavior','safety','other') NOT NULL,
	`message` text NOT NULL,
	`status` enum('open','in_progress','resolved','rejected') NOT NULL DEFAULT 'open',
	`resolutionNote` text,
	`handledByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','support','moderator','admin') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `bookings` ADD `subtotalXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `discountXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `promotionId` int;--> statement-breakpoint
-- Réservations existantes : pas de remise, le sous-total est égal au total.
UPDATE `bookings` SET `subtotalXaf` = `totalXaf` WHERE `subtotalXaf` = 0;--> statement-breakpoint
ALTER TABLE `promotions` ADD `maxUses` int;--> statement-breakpoint
ALTER TABLE `promotions` ADD `onePerCustomer` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `promotions` ADD `minSubtotalXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `promotions` ADD `createdAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);--> statement-breakpoint
CREATE INDEX `reports_reporter_idx` ON `reports` (`reporterUserId`);