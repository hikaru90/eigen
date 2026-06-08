-- Per-event lifecycle for user-facing event management.

ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "lifecycle_status" text NOT NULL DEFAULT 'open';
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "lifecycle_updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp;

CREATE INDEX IF NOT EXISTS "temporal_event_lifecycle_idx" ON "temporal_event" ("user_id", "lifecycle_status");

-- Event reminder preferences on user_preference.

ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "preferred_timezone" text;
ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "event_notifications_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "event_reminder_lead_minutes" integer NOT NULL DEFAULT 10;
ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "event_reminder_kinds" jsonb NOT NULL DEFAULT '["appointment","reminder","deadline"]'::jsonb;

-- Durable reminder schedule (dispatched via pg_cron).

CREATE TABLE IF NOT EXISTS "event_reminder_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"temporal_event_id" uuid NOT NULL REFERENCES "temporal_event"("id") ON DELETE cascade,
	"fire_at" timestamp NOT NULL,
	"lead_minutes" integer NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_reminder_schedule_event_lead_uidx" ON "event_reminder_schedule" ("temporal_event_id", "lead_minutes");
CREATE INDEX IF NOT EXISTS "event_reminder_schedule_fire_idx" ON "event_reminder_schedule" ("status", "fire_at");
CREATE INDEX IF NOT EXISTS "event_reminder_schedule_user_idx" ON "event_reminder_schedule" ("user_id");
