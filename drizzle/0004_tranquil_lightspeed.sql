ALTER TABLE "activity_call_log" ADD COLUMN IF NOT EXISTS "group_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_call_log" ADD COLUMN IF NOT EXISTS "duration_ms" integer;