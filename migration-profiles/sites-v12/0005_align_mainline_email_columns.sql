ALTER TABLE `real_email_outbox` ADD `email_transport` text DEFAULT 'resend' NOT NULL;--> statement-breakpoint
ALTER TABLE `real_email_outbox` ADD `payload_hash` text;