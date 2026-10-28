-- Capture reflection prompts (docs/planning/feature-capture-reflection-prompts.md):
-- one encrypted set of up to three questions per user per local day.
CREATE TABLE IF NOT EXISTS "capture_reflection_prompt" (
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"day" text NOT NULL,
	"prompts_encrypted" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"dismissed_at" timestamp,
	CONSTRAINT "capture_reflection_prompt_pk" PRIMARY KEY ("user_id", "day")
);
--> statement-breakpoint
ALTER TABLE "capture_reflection_prompt" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "capture_reflection_prompt" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS capture_reflection_prompt_own ON "capture_reflection_prompt";
--> statement-breakpoint
CREATE POLICY capture_reflection_prompt_own ON "capture_reflection_prompt"
	FOR ALL
	USING (user_id = current_setting('app.current_user_id', true))
	WITH CHECK (user_id = current_setting('app.current_user_id', true));
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "capture_reflection_prompt" TO eigen_app;
	END IF;
END $$;
