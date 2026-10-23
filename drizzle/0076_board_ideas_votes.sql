-- Multiplayer board (docs/planning/feature-multiplayer-board.md): shared ideas + votes.
-- The board is the first cross-tenant read in the product. Policies are deliberately
-- narrow: ideas are readable by any signed-in session (not hidden), votes are only
-- ever readable by their owner; the score is an aggregate from a SECURITY DEFINER
-- function, and status/note/hidden changes go through an admin SECURITY DEFINER
-- function that checks the role server-side. The same policies live in enable_rls.sql.
CREATE TABLE IF NOT EXISTS "board_idea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" text,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"area" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"planned" boolean DEFAULT false NOT NULL,
	"maker_note" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"title_embedding" vector(1536),
	"feedback_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"shipped_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "board_idea_kind_check" CHECK ("kind" IN ('idea', 'bug', 'polish')),
	CONSTRAINT "board_idea_area_check" CHECK ("area" IN ('capture', 'yarn', 'threads', 'patterns', 'ask', 'better', 'everywhere')),
	CONSTRAINT "board_idea_status_check" CHECK ("status" IN ('requested', 'in-progress', 'shipped')),
	CONSTRAINT "board_idea_title_check" CHECK (length(btrim("title")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_idea_author_user_id_user_id_fk') THEN
		ALTER TABLE "board_idea" ADD CONSTRAINT "board_idea_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE SET NULL;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_idea_feedback_id_feedback_id_fk') THEN
		ALTER TABLE "board_idea" ADD CONSTRAINT "board_idea_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE SET NULL;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_idea_status_idx" ON "board_idea" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_idea_author_idx" ON "board_idea" ("author_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_vote" (
	"idea_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"direction" smallint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "board_vote_pk" PRIMARY KEY ("idea_id", "user_id"),
	CONSTRAINT "board_vote_direction_check" CHECK ("direction" IN (-1, 1))
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_vote_idea_id_board_idea_id_fk') THEN
		ALTER TABLE "board_vote" ADD CONSTRAINT "board_vote_idea_id_board_idea_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."board_idea"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_vote_user_id_user_id_fk') THEN
		ALTER TABLE "board_vote" ADD CONSTRAINT "board_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_vote_idea_idx" ON "board_vote" ("idea_id");
--> statement-breakpoint
-- Protected columns (status, planned, note, hidden, shipped_at, title, author) change only
-- inside the admin SECURITY DEFINER function, which runs as the table owner. The app role's
-- UPDATE policy lets an author correct kind/area; this trigger rejects anything more.
CREATE OR REPLACE FUNCTION board_idea_guard_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
	IF current_user::text = (SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'public.board_idea'::regclass)
		OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
		RETURN NEW;
	END IF;
	IF NEW.status IS DISTINCT FROM OLD.status
		OR NEW.planned IS DISTINCT FROM OLD.planned
		OR NEW.maker_note IS DISTINCT FROM OLD.maker_note
		OR NEW.hidden IS DISTINCT FROM OLD.hidden
		OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
		OR NEW.title IS DISTINCT FROM OLD.title
		OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
		OR NEW.feedback_id IS DISTINCT FROM OLD.feedback_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'board_idea protected columns change only through board_admin_update()'
			USING ERRCODE = '42501';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS board_idea_guard_protected_columns ON "board_idea";
--> statement-breakpoint
CREATE TRIGGER board_idea_guard_protected_columns
	BEFORE UPDATE ON "board_idea"
	FOR EACH ROW EXECUTE FUNCTION board_idea_guard_protected_columns();
--> statement-breakpoint
ALTER TABLE "board_idea" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "board_idea" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS board_idea_read_shared ON "board_idea";
--> statement-breakpoint
CREATE POLICY board_idea_read_shared ON "board_idea"
	FOR SELECT
	USING (coalesce(current_setting('app.current_user_id', true), '') <> '' AND hidden = false);
--> statement-breakpoint
DROP POLICY IF EXISTS board_idea_insert_own ON "board_idea";
--> statement-breakpoint
CREATE POLICY board_idea_insert_own ON "board_idea"
	FOR INSERT
	WITH CHECK (
		author_user_id = current_setting('app.current_user_id', true)
		AND status = 'requested' AND hidden = false AND planned = false
		AND maker_note IS NULL AND shipped_at IS NULL
	);
--> statement-breakpoint
DROP POLICY IF EXISTS board_idea_update_own_requested ON "board_idea";
--> statement-breakpoint
CREATE POLICY board_idea_update_own_requested ON "board_idea"
	FOR UPDATE
	USING (author_user_id = current_setting('app.current_user_id', true) AND status = 'requested')
	WITH CHECK (author_user_id = current_setting('app.current_user_id', true) AND status = 'requested');
--> statement-breakpoint
DROP POLICY IF EXISTS board_idea_delete_own_requested ON "board_idea";
--> statement-breakpoint
CREATE POLICY board_idea_delete_own_requested ON "board_idea"
	FOR DELETE
	USING (author_user_id = current_setting('app.current_user_id', true) AND status = 'requested');
--> statement-breakpoint
ALTER TABLE "board_vote" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "board_vote" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS board_vote_own ON "board_vote";
--> statement-breakpoint
CREATE POLICY board_vote_own ON "board_vote"
	FOR ALL
	USING (user_id = current_setting('app.current_user_id', true))
	WITH CHECK (
		user_id = current_setting('app.current_user_id', true)
		AND EXISTS (
			SELECT 1 FROM board_idea i
			WHERE i.id = board_vote.idea_id AND i.hidden = false AND i.status <> 'shipped'
		)
	);
--> statement-breakpoint
-- Net score per visible idea. Aggregate only: never returns voter ids or single votes.
CREATE OR REPLACE FUNCTION board_scores()
RETURNS TABLE(idea_id uuid, score integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
	SELECT v.idea_id, sum(v.direction)::integer AS score
	FROM board_vote v
	JOIN board_idea i ON i.id = v.idea_id
	WHERE i.hidden = false
		AND coalesce(current_setting('app.current_user_id', true), '') <> ''
	GROUP BY v.idea_id;
$$;
--> statement-breakpoint
-- Makers' controls. NULL arguments leave a column unchanged; p_clear_note clears the note.
-- The role check happens here, server-side, against the session's app.current_user_id.
CREATE OR REPLACE FUNCTION board_admin_update(
	p_idea_id uuid,
	p_status text,
	p_planned boolean,
	p_note text,
	p_clear_note boolean,
	p_hidden boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_found boolean;
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "user" u
		WHERE u.id = current_setting('app.current_user_id', true) AND u.role = 'admin'
	) THEN
		RAISE EXCEPTION 'board_admin_update requires an admin session' USING ERRCODE = '42501';
	END IF;
	IF p_status IS NOT NULL AND p_status NOT IN ('requested', 'in-progress', 'shipped') THEN
		RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = '22023';
	END IF;
	UPDATE board_idea SET
		status = coalesce(p_status, status),
		shipped_at = CASE
			WHEN p_status IS NULL THEN shipped_at
			WHEN p_status = 'shipped' THEN coalesce(shipped_at, now())
			ELSE NULL
		END,
		planned = coalesce(p_planned, planned),
		maker_note = CASE WHEN p_clear_note THEN NULL ELSE coalesce(p_note, maker_note) END,
		hidden = coalesce(p_hidden, hidden),
		updated_at = now()
	WHERE id = p_idea_id
	RETURNING true INTO v_found;
	RETURN coalesce(v_found, false);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION board_scores() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION board_admin_update(uuid, text, boolean, text, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "board_idea" TO eigen_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "board_vote" TO eigen_app;
		GRANT EXECUTE ON FUNCTION board_scores() TO eigen_app;
		GRANT EXECUTE ON FUNCTION board_admin_update(uuid, text, boolean, text, boolean, boolean) TO eigen_app;
	END IF;
END $$;
