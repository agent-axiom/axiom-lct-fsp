CREATE TABLE `guest_workspaces` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guest_session_expiry" CHECK("guest_workspaces"."expires_at">"guest_workspaces"."created_at"),
	CONSTRAINT "guest_session_requests" CHECK("guest_workspaces"."request_count">=0)
);
--> statement-breakpoint
CREATE INDEX `guest_workspaces_expiry` ON `guest_workspaces` (`expires_at`);--> statement-breakpoint
CREATE INDEX `guest_workspaces_created` ON `guest_workspaces` (`created_at`);