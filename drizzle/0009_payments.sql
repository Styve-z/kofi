CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`kind` enum('payment','refund') NOT NULL DEFAULT 'payment',
	`provider` varchar(40) NOT NULL,
	`providerReference` varchar(120) NOT NULL,
	`operator` enum('mtn','orange'),
	`payerPhone` varchar(40),
	`amountXaf` int NOT NULL,
	`status` enum('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
	`failureReason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_providerReference_unique` UNIQUE(`providerReference`)
);
--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professionalId` int NOT NULL,
	`amountXaf` int NOT NULL,
	`note` varchar(255),
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `paymentStatus` enum('none','unpaid','paid','refund_pending','refunded') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `amountDueXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `amountPaidXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `commissionXaf` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `payments_booking_idx` ON `payments` (`bookingId`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payouts_pro_idx` ON `payouts` (`professionalId`);