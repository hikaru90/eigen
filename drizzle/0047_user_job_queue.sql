CREATE TABLE IF NOT EXISTS "user_scheduled_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"task_type" text NOT NULL,
	"run_hour" integer DEFAULT 2 NOT NULL,
	"run_minute" integer DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_enqueued_night" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_scheduled_task_user_type_uidx" ON "user_scheduled_task" ("user_id", "task_type");
CREATE INDEX IF NOT EXISTS "user_scheduled_task_user_idx" ON "user_scheduled_task" ("user_id");

CREATE TABLE IF NOT EXISTS "user_job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_after" timestamp NOT NULL,
	"dedupe_key" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"heartbeat_run_id" uuid REFERENCES "heartbeat_run"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);

CREATE INDEX IF NOT EXISTS "user_job_queue_pending_idx" ON "user_job_queue" ("status", "run_after");
CREATE INDEX IF NOT EXISTS "user_job_queue_user_status_idx" ON "user_job_queue" ("user_id", "status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "user_job_queue_active_dedupe_uidx" ON "user_job_queue" ("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL AND "status" IN ('pending', 'running');
