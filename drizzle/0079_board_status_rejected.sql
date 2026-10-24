-- Board status `rejected` (docs/planning/feature-multiplayer-board.md): the makers decline an idea.
-- Rejected ideas leave the board for every session (RLS read policy), take no votes and no
-- score; board_admin_update can set it and restore it. Mirrors enable_rls.sql.
ALTER TABLE "board_idea" DROP CONSTRAINT IF EXISTS "board_idea_status_check";
--> statement-breakpoint
ALTER TABLE "board_idea" ADD CONSTRAINT "board_idea_status_check" CHECK ("status" IN ('requested', 'in-progress', 'shipped', 'rejected'));
--> statement-breakpoint
DROP POLICY IF EXISTS board_idea_read_shared ON "board_idea";
--> statement-breakpoint
CREATE POLICY board_idea_read_shared ON "board_idea"
	FOR SELECT
	USING (
		coalesce(current_setting('app.current_user_id', true), '') <> ''
		AND hidden = false AND status <> 'rejected'
	);
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
			WHERE i.id = board_vote.idea_id AND i.hidden = false AND i.status NOT IN ('shipped', 'rejected')
		)
	);
--> statement-breakpoint
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
	WHERE i.hidden = false AND i.status <> 'rejected'
		AND coalesce(current_setting('app.current_user_id', true), '') <> ''
	GROUP BY v.idea_id;
$$;
--> statement-breakpoint
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
	IF p_status IS NOT NULL AND p_status NOT IN ('requested', 'in-progress', 'shipped', 'rejected') THEN
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
