ALTER TABLE `users` ADD `twoFactorSecret` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `twoFactorPendingSecret` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `twoFactorEnabledAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `twoFactorBackupCodes` text;--> statement-breakpoint
ALTER TABLE `users` ADD `twoFactorLastStep` int;