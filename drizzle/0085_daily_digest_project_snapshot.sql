-- Next action per project at the last daily digest send (the next digest diffs against it).
CREATE TABLE IF NOT EXISTS "daily_digest_project_snapshot" (
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"project_entity_id" uuid NOT NULL REFERENCES "canonical_entity"("id") ON DELETE CASCADE,
	"next_action_summary" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_digest_project_snapshot_pk" PRIMARY KEY ("user_id", "project_entity_id")
);
--> statement-breakpoint
ALTER TABLE "daily_digest_project_snapshot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_digest_project_snapshot" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS daily_digest_project_snapshot_own ON "daily_digest_project_snapshot";
--> statement-breakpoint
CREATE POLICY daily_digest_project_snapshot_own ON "daily_digest_project_snapshot"
	FOR ALL
	USING (user_id = current_setting('app.current_user_id', true))
	WITH CHECK (user_id = current_setting('app.current_user_id', true));
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_digest_project_snapshot" TO eigen_app;
	END IF;
END $$;
