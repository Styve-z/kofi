CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int NOT NULL,
	`action` varchar(120) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` varchar(80) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `availability_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professionalId` int NOT NULL,
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`status` enum('open','blocked','leave','holiday') NOT NULL DEFAULT 'open',
	`note` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `availability_slots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`actorUserId` int,
	`fromStatus` varchar(40),
	`toStatus` varchar(40) NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`serviceId` int NOT NULL,
	`serviceName` varchar(180) NOT NULL,
	`durationMinutes` int NOT NULL,
	`priceXaf` int NOT NULL,
	CONSTRAINT `booking_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(40) NOT NULL,
	`customerUserId` int,
	`professionalId` int NOT NULL,
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Africa/Douala',
	`mode` enum('salon','domicile') NOT NULL,
	`address` text,
	`customerName` varchar(180) NOT NULL,
	`customerPhone` varchar(40) NOT NULL,
	`notes` text,
	`totalXaf` int NOT NULL,
	`status` enum('pending','confirmed','refused','cancelled','completed','no_show') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `portfolio_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professionalId` int NOT NULL,
	`objectKey` varchar(255) NOT NULL,
	`stableUrl` varchar(500) NOT NULL,
	`description` text,
	`serviceId` int,
	`moderationStatus` enum('pending','approved','rejected','removed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `portfolio_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professional_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int,
	`slug` varchar(140) NOT NULL,
	`displayName` varchar(180) NOT NULL,
	`salonName` varchar(180),
	`city` varchar(80) NOT NULL,
	`neighborhood` varchar(120),
	`mode` enum('salon','domicile','les deux') NOT NULL DEFAULT 'salon',
	`bio` text,
	`verificationStatus` enum('pending','verified','suspended') NOT NULL DEFAULT 'pending',
	`rating` decimal(3,2) NOT NULL DEFAULT '0.00',
	`reviewCount` int NOT NULL DEFAULT 0,
	`timezone` varchar(64) NOT NULL DEFAULT 'Africa/Douala',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professional_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `professional_profiles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`label` varchar(180) NOT NULL,
	`discountType` enum('fixed','percentage') NOT NULL,
	`discountValue` int NOT NULL,
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`isEnabled` int NOT NULL DEFAULT 1,
	CONSTRAINT `promotions_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `service_catalog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professionalId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`category` varchar(100),
	`durationMinutes` int NOT NULL,
	`preparationMinutes` int NOT NULL DEFAULT 0,
	`priceXaf` int NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_catalog_id` PRIMARY KEY(`id`)
);
