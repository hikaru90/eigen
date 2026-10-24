-- Makers (admins) edit any idea's title and delete any idea. Both run as the table owner
-- (SECURITY DEFINER) so the protected-column trigger and the author-only delete policy stay
-- in force for everyone else; the admin role is checked in SQL, like board_admin_update.
CREATE OR REPLACE FUNCTION board_admin_set_title(p_idea_id uuid, p_title text, p_title_embedding vector)
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
		RAISE EXCEPTION 'board_admin_set_title requires an admin session' USING ERRCODE = '42501';
	END IF;
	IF p_title IS NULL OR btrim(p_title) = '' THEN
		RAISE EXCEPTION 'title must not be empty' USING ERRCODE = '22023';
	END IF;
	UPDATE board_idea SET
		title = btrim(p_title),
		title_embedding = p_title_embedding,
		updated_at = now()
	WHERE id = p_idea_id
	RETURNING true INTO v_found;
	RETURN coalesce(v_found, false);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION board_admin_delete(p_idea_id uuid)
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
		RAISE EXCEPTION 'board_admin_delete requires an admin session' USING ERRCODE = '42501';
	END IF;
	DELETE FROM board_idea WHERE id = p_idea_id RETURNING true INTO v_found;
	RETURN coalesce(v_found, false);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION board_admin_set_title(uuid, text, vector) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION board_admin_delete(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT EXECUTE ON FUNCTION board_admin_set_title(uuid, text, vector) TO eigen_app;
		GRANT EXECUTE ON FUNCTION board_admin_delete(uuid) TO eigen_app;
	END IF;
END $$;
