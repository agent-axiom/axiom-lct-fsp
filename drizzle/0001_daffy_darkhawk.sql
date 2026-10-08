CREATE TABLE `real_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`privacy_accepted_at` integer NOT NULL,
	`privacy_notice_version` text NOT NULL,
	`email_verified_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "real_accounts_role" CHECK("real_accounts"."role" in ('candidate','employer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `real_accounts_identity` ON `real_accounts` (`issuer`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `real_accounts_email` ON `real_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `real_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`specialization` text NOT NULL,
	`grade` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`score` integer,
	`passed` integer,
	`version` integer NOT NULL,
	`questions_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `real_assessments_account_created` ON `real_assessments` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `real_candidate_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`about` text DEFAULT '' NOT NULL,
	`experience` integer DEFAULT 0 NOT NULL,
	`soft_skills` text DEFAULT '' NOT NULL,
	`consent` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`specialization` text DEFAULT 'Backend' NOT NULL,
	`grade` text DEFAULT 'Junior' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`category_confirmed` integer DEFAULT 0 NOT NULL,
	`grade_changed_at` integer,
	`current_assessment_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "real_profile_publication_consent" CHECK("real_candidate_profiles"."published"=0 OR "real_candidate_profiles"."consent"=1)
);
--> statement-breakpoint
CREATE INDEX `real_candidates_visibility` ON `real_candidate_profiles` (`published`,`consent`,`category_confirmed`);--> statement-breakpoint
CREATE TABLE `real_email_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`recipient` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`delivery_state` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "real_challenge_attempts" CHECK("real_email_challenges"."failed_attempts">=0 AND "real_email_challenges"."failed_attempts"<=5)
);
--> statement-breakpoint
CREATE INDEX `real_challenges_account_created` ON `real_email_challenges` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `real_email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`last_error_code` text,
	`provider_message_id` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`challenge_id`) REFERENCES `real_email_challenges`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "real_outbox_status" CHECK("real_email_outbox"."status" in ('blocked','queued','leased','retry','sent','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `real_outbox_challenge` ON `real_email_outbox` (`challenge_id`);--> statement-breakpoint
CREATE INDEX `real_outbox_ready` ON `real_email_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `real_employer_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `real_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_name` text NOT NULL,
	`company` text NOT NULL,
	`employer_contact` text NOT NULL,
	`description` text NOT NULL,
	`salary_from` integer NOT NULL,
	`salary_to` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`employer_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "real_invitation_salary" CHECK("real_invitations"."salary_from">0 AND "real_invitations"."salary_to">="real_invitations"."salary_from" AND "real_invitations"."salary_to"<=10000000),
	CONSTRAINT "real_invitation_status" CHECK("real_invitations"."status" in ('sent','viewed','accepted','declined'))
);
--> statement-breakpoint
CREATE INDEX `real_invites_employer` ON `real_invitations` (`employer_id`);--> statement-breakpoint
CREATE INDEX `real_invites_candidate` ON `real_invitations` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `real_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`op_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `real_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`filters_json` text NOT NULL,
	`candidate_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `real_searches_account_created` ON `real_searches` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `real_skill_evidence` (
	`assessment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`skill` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	`score` integer NOT NULL,
	`confirmed` integer NOT NULL,
	PRIMARY KEY(`assessment_id`, `skill`),
	FOREIGN KEY (`assessment_id`) REFERENCES `real_assessments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `real_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `real_evidence_account` ON `real_skill_evidence` (`account_id`);