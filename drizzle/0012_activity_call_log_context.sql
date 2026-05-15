-- Migration: 0012_activity_call_log_context
-- Adds context column to activity_call_log for storing brief content previews

--> statement-breakpoint

-- Add context column to activity_call_log
ALTER TABLE "activity_call_log" ADD COLUMN IF NOT EXISTS "context" text;

--> statement-breakpoint

-- Create index on context for potential filtering/searching
CREATE INDEX IF NOT EXISTS "activity_call_log_context_idx" ON "activity_call_log" USING btree ("user_id", "context") WHERE "context" IS NOT NULL;
