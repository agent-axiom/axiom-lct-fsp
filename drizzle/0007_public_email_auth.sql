CREATE TABLE `public_email_auth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`mode` text NOT NULL,
	`role` text,
	`name` text,
	`privacy_notice_version` text,
	`privacy_accepted_at` integer,
	`token_hash` text NOT NULL,
	`browser_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`delivery_state` text DEFAULT 'pending' NOT NULL,
	`consumed_at` integer,
	`consume_operation` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`error_code` text,
	CONSTRAINT "public_auth_mode" CHECK("public_email_auth_requests"."mode" in ('login','register')),
	CONSTRAINT "public_auth_role" CHECK("public_email_auth_requests"."role" IS NULL OR "public_email_auth_requests"."role" in ('candidate','employer')),
	CONSTRAINT "public_auth_attempts" CHECK("public_email_auth_requests"."failed_attempts">=0 AND "public_email_auth_requests"."failed_attempts"<=5),
	CONSTRAINT "public_auth_delivery" CHECK("public_email_auth_requests"."delivery_state" in ('pending','sending','accepted','rejected','unknown')),
	CONSTRAINT "public_auth_expiration" CHECK("public_email_auth_requests"."expires_at">"public_email_auth_requests"."created_at")
);
--> statement-breakpoint
CREATE INDEX `public_auth_email_created` ON `public_email_auth_requests` (`email`,`created_at`);
--> statement-breakpoint
CREATE INDEX `public_auth_expiry` ON `public_email_auth_requests` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `public_account_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "public_session_expiration" CHECK("public_account_sessions"."expires_at">"public_account_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `public_sessions_account` ON `public_account_sessions` (`account_id`);
--> statement-breakpoint
CREATE INDEX `public_sessions_expiry` ON `public_account_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `public_email_auth_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`operation_id` text NOT NULL,
	CONSTRAINT "public_auth_limit_count" CHECK("public_email_auth_limits"."request_count">=0)
);
