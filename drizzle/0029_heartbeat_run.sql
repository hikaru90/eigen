CREATE TABLE IF NOT EXISTS "heartbeat_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"jobs" jsonb NOT NULL,
	"total_duration_ms" integer NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'heartbeat_run_user_id_user_id_fk'
	) THEN
		ALTER TABLE "heartbeat_run" ADD CONSTRAINT "heartbeat_run_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "heartbeat_run_user_started_idx" ON "heartbeat_run" ("user_id", "started_at");
