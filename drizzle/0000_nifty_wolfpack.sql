CREATE TABLE `facebook_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`page_name` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_iv` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `facebook_page_choices` (
	`user_id` text NOT NULL,
	`page_id` text NOT NULL,
	`page_name` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_iv` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `page_id`)
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`r2_key` text,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`planned_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`facebook_video_id` text,
	`created_at` text NOT NULL,
	`published_at` text
);
