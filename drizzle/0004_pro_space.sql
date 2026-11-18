ALTER TABLE `professional_profiles` ADD `weeklyHours` text;--> statement-breakpoint
ALTER TABLE `professional_profiles` ADD CONSTRAINT `professional_profiles_owner_uq` UNIQUE(`ownerUserId`);