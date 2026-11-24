CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`year` text NOT NULL,
	`status` text NOT NULL,
	`step` text,
	`error` text,
	`workflow_id` text,
	`model` text,
	`lto_hash` text,
	`documents_hash` text,
	`has_results` integer DEFAULT false NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_course_year_idx` ON `analyses` (`course_id`,`year`);--> statement-breakpoint
CREATE TABLE `analysis_fields` (
	`analysis_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`status` text NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`page` integer,
	`verification` text NOT NULL,
	PRIMARY KEY(`analysis_id`, `key`),
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analysis_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`name` text NOT NULL,
	`weight` real,
	`grading` text DEFAULT '' NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`page` integer,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_programme_code_idx` ON `courses` (`programme_id`,`code`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`year` text NOT NULL,
	`lto_id` integer NOT NULL,
	`domain` text,
	`level` text,
	`text` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lto_id`) REFERENCES `ltos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `disputes_course_idx` ON `disputes` (`course_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`year` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`r2_key` text NOT NULL,
	`uploaded_by` text,
	`uploaded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_course_year_idx` ON `documents` (`course_id`,`year`);--> statement-breakpoint
CREATE TABLE `extraction_cache` (
	`sha256` text NOT NULL,
	`cache_key` text NOT NULL,
	`result` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`sha256`, `cache_key`)
);
--> statement-breakpoint
CREATE TABLE `extraction_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraction_fields_programme_key_idx` ON `extraction_fields` (`programme_id`,`key`);--> statement-breakpoint
CREATE TABLE `frameworks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `images` (
	`key` text PRIMARY KEY NOT NULL,
	`programme_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `indicators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`framework_id` integer NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`framework_id`) REFERENCES `frameworks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `justifications` (
	`lto_id` integer NOT NULL,
	`indicator_id` integer NOT NULL,
	`programme_id` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`lto_id`, `indicator_id`),
	FOREIGN KEY (`lto_id`) REFERENCES `ltos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `link_statements` (
	`link_id` integer NOT NULL,
	`statement_id` integer NOT NULL,
	PRIMARY KEY(`link_id`, `statement_id`),
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`statement_id`) REFERENCES `statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analysis_id` integer NOT NULL,
	`lto_id` integer NOT NULL,
	`domain` text NOT NULL,
	`level` text NOT NULL,
	`justification` text NOT NULL,
	`confidence` real NOT NULL,
	`tested` integer NOT NULL,
	`origin` text NOT NULL,
	`pointer_id` integer,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lto_id`) REFERENCES `ltos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pointer_id`) REFERENCES `pointers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `links_analysis_idx` ON `links` (`analysis_id`);--> statement-breakpoint
CREATE INDEX `links_lto_idx` ON `links` (`lto_id`);--> statement-breakpoint
CREATE TABLE `ltos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`trajectory_id` integer NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`narrative` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trajectory_id`) REFERENCES `trajectories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ltos_programme_code_idx` ON `ltos` (`programme_id`,`code`);--> statement-breakpoint
CREATE INDEX `ltos_trajectory_idx` ON `ltos` (`trajectory_id`);--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`email` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pointers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`year` text NOT NULL,
	`lto_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`passage` text NOT NULL,
	`page` integer,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`verdict` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lto_id`) REFERENCES `ltos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pointers_course_year_idx` ON `pointers` (`course_id`,`year`);--> statement-breakpoint
CREATE TABLE `programme_roles` (
	`programme_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`scope_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`programme_id`, `user_id`, `role`, `scope_id`),
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `programme_roles_user_idx` ON `programme_roles` (`user_id`);--> statement-breakpoint
CREATE TABLE `programmes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`current_year` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rubrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analysis_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`assessment` text NOT NULL,
	`criteria` text NOT NULL,
	`page` integer,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`token` text PRIMARY KEY NOT NULL,
	`programme_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analysis_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`kind` text NOT NULL,
	`section` text DEFAULT '' NOT NULL,
	`quote` text NOT NULL,
	`page` integer,
	`verification` text NOT NULL,
	`assessed_by` text NOT NULL,
	`pointer_id` integer,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pointer_id`) REFERENCES `pointers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `statements_analysis_idx` ON `statements` (`analysis_id`);--> statement-breakpoint
CREATE TABLE `trajectories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`programme_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`narrative` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`programme_id`) REFERENCES `programmes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trajectories_programme_name_idx` ON `trajectories` (`programme_id`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`is_server_admin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);