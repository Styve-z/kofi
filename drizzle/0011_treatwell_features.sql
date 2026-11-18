CREATE TABLE `favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`professionalId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `favorites_user_pro_uq` UNIQUE(`userId`,`professionalId`)
);
--> statement-breakpoint
CREATE TABLE `gift_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(24) NOT NULL,
	`initialXaf` int NOT NULL,
	`balanceXaf` int NOT NULL,
	`purchaserUserId` int NOT NULL,
	`recipientName` varchar(120),
	`message` varchar(300),
	`status` enum('pending_payment','active','cancelled') NOT NULL DEFAULT 'pending_payment',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`activatedAt` timestamp,
	CONSTRAINT `gift_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `gift_cards_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bookingId` int,
	`points` int NOT NULL,
	`reason` varchar(180) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loyalty_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `offpeak_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professionalId` int NOT NULL,
	`dayOfWeek` int NOT NULL,
	`startTime` varchar(5) NOT NULL,
	`endTime` varchar(5) NOT NULL,
	`percent` int NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `offpeak_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professionalId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`title` varchar(120),
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `bookingId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `staffMemberId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `offpeakPercent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `offpeakDiscountXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `loyaltyPointsUsed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `loyaltyDiscountXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `giftCardId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `giftCardXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `loyaltyEarned` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `giftCardId` int;--> statement-breakpoint
CREATE INDEX `gift_cards_purchaser_idx` ON `gift_cards` (`purchaserUserId`);--> statement-breakpoint
CREATE INDEX `loyalty_user_idx` ON `loyalty_ledger` (`userId`);--> statement-breakpoint
CREATE INDEX `offpeak_pro_idx` ON `offpeak_rules` (`professionalId`);--> statement-breakpoint
CREATE INDEX `staff_members_pro_idx` ON `staff_members` (`professionalId`);