ALTER TABLE `portfolio_items` ADD `thumbKey` varchar(255);--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `thumbUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `width` int;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `height` int;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `moderationNote` varchar(255);--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `moderatedByUserId` int;--> statement-breakpoint
CREATE INDEX `portfolio_pro_status_idx` ON `portfolio_items` (`professionalId`,`moderationStatus`);