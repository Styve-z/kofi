ALTER TABLE `professional_profiles` MODIFY COLUMN `verificationStatus` enum('pending','verified','suspended','refused') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `professional_profiles` ADD `verificationNote` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('active','suspended') DEFAULT 'active' NOT NULL;