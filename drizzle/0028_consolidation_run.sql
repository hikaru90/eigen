CREATE TABLE IF NOT EXISTS "consolidation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_night" date NOT NULL,
	"status" text NOT NULL,
	"jobs" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "consolidation_run_nightly_uidx" ON "consolidation_run" ("run_night");
