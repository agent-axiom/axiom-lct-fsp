CREATE TABLE `owner_email_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`provider_message_id` text,
	`error_code` text,
	CONSTRAINT "owner_email_test_status" CHECK("owner_email_tests"."status" in ('sending','accepted','rejected','unknown'))
);
