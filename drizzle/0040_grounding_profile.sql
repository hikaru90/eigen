CREATE TABLE IF NOT EXISTS "user_grounding_profile" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"narrative_summary_encrypted" text,
	"facets" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"initial_completed_at" timestamp,
	"last_session_at" timestamp,
	"session_count" integer NOT NULL DEFAULT 0,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_session" ADD COLUMN IF NOT EXISTS "mode" text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE "chat_session" DROP CONSTRAINT IF EXISTS "chat_session_mode_check";
--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_mode_check" CHECK ("mode" IN ('default', 'grounding'));
