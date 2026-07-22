ALTER TABLE "user_grounding_profile" ADD COLUMN IF NOT EXISTS "last_grounding_push_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_grounding_profile" ADD COLUMN IF NOT EXISTS "pending_check_in" jsonb;
