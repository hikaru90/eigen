-- Clef decision-model shadow log for thought-category classification.
-- Metadata-only diagnostics (mirrors retrieval_quality_event, AC-024):
-- no thought text, thought ids, or bodies — category keys, probabilities, timings, errors.
CREATE TABLE IF NOT EXISTS "decision_shadow_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"surface" text NOT NULL,
	"llm_category" text NOT NULL,
	"llm_confidence" double precision,
	"clef_category" text,
	"clef_probability" double precision,
	"clef_alternatives" jsonb,
	"agree" boolean,
	"clef_error" text,
	"clef_duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_shadow_log_user_idx" ON "decision_shadow_log" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_shadow_log_created_idx" ON "decision_shadow_log" ("created_at");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'decision_shadow_log_user_id_user_id_fk'
	) THEN
		ALTER TABLE "decision_shadow_log" ADD CONSTRAINT "decision_shadow_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE;
	END IF;
END $$;
