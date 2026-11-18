CREATE TABLE `email_verification_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_verification_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `message_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` enum('email','sms') NOT NULL,
	`recipient` varchar(320) NOT NULL,
	`subject` varchar(200),
	`body` text NOT NULL,
	`kind` varchar(64) NOT NULL,
	`status` enum('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` varchar(255),
	`sendAfter` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `message_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `reminderSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerifiedAt` timestamp;--> statement-breakpoint
CREATE INDEX `email_verification_user_idx` ON `email_verification_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `message_outbox_status_idx` ON `message_outbox` (`status`,`sendAfter`);