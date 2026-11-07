CREATE TABLE `meta_app_configs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`app_secret_ciphertext` text NOT NULL,
	`app_secret_iv` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
