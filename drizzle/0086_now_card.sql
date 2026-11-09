-- Now cards on Yarn (docs/planning/feature-mesh-now.md, NOW-8):
-- one row per card of a written deck; text/why/suggestion live in payload_encrypted.
CREATE TABLE IF NOT EXISTS "now_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"local_day" text NOT NULL,
	"deck_number" integer NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"target_thought_id" uuid REFERENCES "thought"("id") ON DELETE CASCADE,
	"target_project_entity_id" uuid REFERENCES "canonical_entity"("id") ON DELETE CASCADE,
	"payload_encrypted" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"undo_state_encrypted" text,
	"hidden_until" timestamp,
	"answered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "now_card_user_day_deck_position_uidx" ON "now_card" ("user_id", "local_day", "deck_number", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "now_card_user_status_idx" ON "now_card" ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "now_card_user_target_thought_idx" ON "now_card" ("user_id", "target_thought_id");
--> statement-breakpoint
ALTER TABLE "now_card" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "now_card" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS now_card_own ON "now_card";
--> statement-breakpoint
CREATE POLICY now_card_own ON "now_card"
	FOR ALL
	USING (user_id = current_setting('app.current_user_id', true))
	WITH CHECK (user_id = current_setting('app.current_user_id', true));
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "now_card" TO eigen_app;
	END IF;
END $$;
