ALTER TABLE "heartbeat_run" ADD COLUMN IF NOT EXISTS "current_job" text;
ALTER TABLE "heartbeat_run" ADD COLUMN IF NOT EXISTS "cancel_requested" boolean NOT NULL DEFAULT false;
ALTER TABLE "heartbeat_run" ADD COLUMN IF NOT EXISTS "planned_jobs" jsonb;
