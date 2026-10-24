-- In-app notifications (You menu → Notifications) and the shipped-idea reward.
CREATE TABLE IF NOT EXISTS "user_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notification_user_created_idx" ON "user_notification" ("user_id", "created_at");
--> statement-breakpoint
ALTER TABLE "user_notification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_notification" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS user_notification_own ON "user_notification";
--> statement-breakpoint
CREATE POLICY user_notification_own ON "user_notification"
	FOR ALL
	USING (user_id = current_setting('app.current_user_id', true))
	WITH CHECK (user_id = current_setting('app.current_user_id', true));
--> statement-breakpoint
-- One reward per shipped idea, enforced by the database (re-shipping never pays twice).
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_board_reward_once"
	ON "wallet_ledger_entry" ("reference_id")
	WHERE "reference_type" = 'board_idea_shipped';
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "user_notification" TO eigen_app;
	END IF;
END $$;
