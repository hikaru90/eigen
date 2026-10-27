-- Capture review (docs/planning/capture-feedback.md, phase C1): one record per captured thought
-- holding how sure Eigen is that it stored the capture right. `parts` is a list of
-- { part, ref, engine, label, probability } with NO user text: Jev's confidence for the decisions
-- Jev made at capture (jev_decision) and Jev's check of what the chat model wrote (jev_audit).
-- `score` is the weakest part. The vote columns (verdict .. edit_applied_at) are written by the
-- vote endpoint in phase C2; C1 never writes them.
CREATE TABLE IF NOT EXISTS "capture_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"thought_id" uuid NOT NULL REFERENCES "thought"("id") ON DELETE CASCADE,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" real,
	"status" text NOT NULL,
	"audit_error" text,
	"verdict" text,
	"voted_at" timestamp with time zone,
	"voted_on" text,
	"reason_encrypted" text,
	"reason_kind" text,
	"edit_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capture_review_thought_uidx" UNIQUE ("thought_id"),
	CONSTRAINT "capture_review_status_check" CHECK ("status" IN ('pending_audit', 'scored', 'audit_failed')),
	CONSTRAINT "capture_review_verdict_check" CHECK ("verdict" IS NULL OR "verdict" IN ('up', 'down')),
	CONSTRAINT "capture_review_voted_on_check" CHECK ("voted_on" IS NULL OR "voted_on" IN ('capture', 'mesh')),
	CONSTRAINT "capture_review_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capture_review_user_idx" ON "capture_review" ("user_id");
--> statement-breakpoint
ALTER TABLE "capture_review" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "capture_review" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS capture_review_isolation ON "capture_review";
--> statement-breakpoint
CREATE POLICY capture_review_isolation ON "capture_review"
	FOR ALL
	USING (user_id = current_setting('app.current_user_id', true))
	WITH CHECK (user_id = current_setting('app.current_user_id', true));
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "capture_review" TO eigen_app;
	END IF;
END $$;
