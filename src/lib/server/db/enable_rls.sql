-- Eigen: tenant RLS (user_id). Apply with `npm run db:rls` after `DATABASE_URL` is set.
-- App requests set GUC on the pooled connection: set_config('app.current_user_id', <id>, false) — see src/hooks.server.ts.
--
-- Intentional exceptions (no tenant policy, by design):
--   user              — Better Auth identity; SELECT-only policy below, writes via the superuser auth pool.
--   consolidation_run — global nightly ledger across users (operator cron context).
--   eval_qa           — shared operator eval catalog (no user_id column).
-- Everything else holding tenant data must have ENABLE + FORCE + a user_id policy here.

-- The `user` table is managed by better-auth and may have RLS enabled.
-- Add a permissive SELECT policy so the app role can read users for FK checks.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_read_all ON "user";
CREATE POLICY user_read_all ON "user"
  FOR SELECT
  USING (true);

ALTER TABLE thought ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thought_isolation ON thought;
CREATE POLICY thought_isolation ON thought
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE capture_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_session_isolation ON capture_session;
CREATE POLICY capture_session_isolation ON capture_session
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE thought_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought_relation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thought_relation_isolation ON thought_relation;
CREATE POLICY thought_relation_isolation ON thought_relation
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE activity_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_call_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_call_log_isolation ON activity_call_log;
CREATE POLICY activity_call_log_isolation ON activity_call_log
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE user_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preference FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_preference_isolation ON user_preference;
CREATE POLICY user_preference_isolation ON user_preference
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE heartbeat_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS heartbeat_run_isolation ON heartbeat_run;
CREATE POLICY heartbeat_run_isolation ON heartbeat_run
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE user_scheduled_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_scheduled_task FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_scheduled_task_isolation ON user_scheduled_task;
CREATE POLICY user_scheduled_task_isolation ON user_scheduled_task
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE user_job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_job_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_job_queue_isolation ON user_job_queue;
CREATE POLICY user_job_queue_isolation ON user_job_queue
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE connected_agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_agent FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connected_agent_isolation ON connected_agent;
CREATE POLICY connected_agent_isolation ON connected_agent
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE agent_task_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_assignment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_task_assignment_isolation ON agent_task_assignment;
CREATE POLICY agent_task_assignment_isolation ON agent_task_assignment
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_delivery_isolation ON webhook_delivery;
CREATE POLICY webhook_delivery_isolation ON webhook_delivery
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE user_ontology ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ontology FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_ontology_isolation ON user_ontology;
CREATE POLICY user_ontology_isolation ON user_ontology
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE user_grounding_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_grounding_profile FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_grounding_profile_isolation ON user_grounding_profile;
CREATE POLICY user_grounding_profile_isolation ON user_grounding_profile
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE ontology_entity_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_entity_kind FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ontology_entity_kind_isolation ON ontology_entity_kind;
CREATE POLICY ontology_entity_kind_isolation ON ontology_entity_kind
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE ontology_relation_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_relation_kind FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ontology_relation_kind_isolation ON ontology_relation_kind;
CREATE POLICY ontology_relation_kind_isolation ON ontology_relation_kind
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE canonical_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_entity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canonical_entity_isolation ON canonical_entity;
CREATE POLICY canonical_entity_isolation ON canonical_entity
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE entity_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_alias FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_alias_isolation ON entity_alias;
CREATE POLICY entity_alias_isolation ON entity_alias
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE entity_resolution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_resolution_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_resolution_log_isolation ON entity_resolution_log;
CREATE POLICY entity_resolution_log_isolation ON entity_resolution_log
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE retrieval_quality_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_quality_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retrieval_quality_event_isolation ON retrieval_quality_event;
CREATE POLICY retrieval_quality_event_isolation ON retrieval_quality_event
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE chat_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_session_isolation ON chat_session;
CREATE POLICY chat_session_isolation ON chat_session
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_message_isolation ON chat_message;
CREATE POLICY chat_message_isolation ON chat_message
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE llm_active_provider ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_active_provider FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_active_provider_isolation ON llm_active_provider;
CREATE POLICY llm_active_provider_isolation ON llm_active_provider
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE llm_provider_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_provider_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_provider_config_isolation ON llm_provider_config;
CREATE POLICY llm_provider_config_isolation ON llm_provider_config
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE tenant_data_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data_key FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_data_key_isolation ON tenant_data_key;
CREATE POLICY tenant_data_key_isolation ON tenant_data_key
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE eval_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eval_run_isolation ON eval_run;
CREATE POLICY eval_run_isolation ON eval_run
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE eval_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_entry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eval_entry_isolation ON eval_entry;
CREATE POLICY eval_entry_isolation ON eval_entry
  FOR ALL
  USING (
    run_id IN (
      SELECT id FROM eval_run
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT id FROM eval_run
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE eval_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eval_event_isolation ON eval_event;
CREATE POLICY eval_event_isolation ON eval_event
  FOR ALL
  USING (
    run_id IN (
      SELECT id FROM eval_run
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT id FROM eval_run
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE temporal_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporal_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS temporal_event_isolation ON temporal_event;
CREATE POLICY temporal_event_isolation ON temporal_event
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE graph_sync_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_sync_job FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS graph_sync_job_isolation ON graph_sync_job;
CREATE POLICY graph_sync_job_isolation ON graph_sync_job
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE event_reminder_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_reminder_schedule FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_reminder_schedule_isolation ON event_reminder_schedule;
CREATE POLICY event_reminder_schedule_isolation ON event_reminder_schedule
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscription FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscription_isolation ON push_subscription;
CREATE POLICY push_subscription_isolation ON push_subscription
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE eval_thought_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_thought_map FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eval_thought_map_isolation ON eval_thought_map;
CREATE POLICY eval_thought_map_isolation ON eval_thought_map
  FOR ALL
  USING (
    run_id IN (
      SELECT id FROM eval_run
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT id FROM eval_run
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE user_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_wallet FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_wallet_isolation ON user_wallet;
CREATE POLICY user_wallet_isolation ON user_wallet
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE wallet_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger_entry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_ledger_entry_isolation ON wallet_ledger_entry;
CREATE POLICY wallet_ledger_entry_isolation ON wallet_ledger_entry
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE payment_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_order FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_order_isolation ON payment_order;
CREATE POLICY payment_order_isolation ON payment_order
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE user_api_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_key FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_api_key_isolation ON user_api_key;
CREATE POLICY user_api_key_isolation ON user_api_key
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE graph_community ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_community FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS graph_community_isolation ON graph_community;
CREATE POLICY graph_community_isolation ON graph_community
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE community_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_member FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_member_isolation ON community_member;
CREATE POLICY community_member_isolation ON community_member
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE community_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_summary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_summary_isolation ON community_summary;
CREATE POLICY community_summary_isolation ON community_summary
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE ontology_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_proposal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ontology_proposal_isolation ON ontology_proposal;
CREATE POLICY ontology_proposal_isolation ON ontology_proposal
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE text_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_file FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS text_file_isolation ON text_file;
CREATE POLICY text_file_isolation ON text_file
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE thought_text_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought_text_file FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thought_text_file_isolation ON thought_text_file;
CREATE POLICY thought_text_file_isolation ON thought_text_file
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE thought_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought_entity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thought_entity_isolation ON thought_entity;
CREATE POLICY thought_entity_isolation ON thought_entity
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE thought_neighbor ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought_neighbor FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thought_neighbor_isolation ON thought_neighbor;
CREATE POLICY thought_neighbor_isolation ON thought_neighbor
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE entity_top_thoughts ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_top_thoughts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_top_thoughts_isolation ON entity_top_thoughts;
CREATE POLICY entity_top_thoughts_isolation ON entity_top_thoughts
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE community_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_bundle FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_bundle_isolation ON community_bundle;
CREATE POLICY community_bundle_isolation ON community_bundle
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE agent_project_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_project_binding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_project_binding_isolation ON agent_project_binding;
CREATE POLICY agent_project_binding_isolation ON agent_project_binding
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_isolation ON feedback;
CREATE POLICY feedback_isolation ON feedback
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

-- Bearer API key auth runs before app.current_user_id is set; resolve via SECURITY DEFINER.
-- These live in public (apply-rls.mjs pins search_path). Earlier boots without that pin
-- recreated them in ag_catalog; drop those strays so only the public copies remain.
DROP FUNCTION IF EXISTS ag_catalog.resolve_user_api_key(text);
DROP FUNCTION IF EXISTS ag_catalog.touch_user_api_key(uuid);
DROP FUNCTION IF EXISTS ag_catalog.resolve_agent_callback_token(text);
DROP FUNCTION IF EXISTS resolve_user_api_key(text);

CREATE OR REPLACE FUNCTION resolve_user_api_key(p_key_hash text)
RETURNS TABLE(id uuid, user_id text, key_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT uak.id, uak.user_id, uak.name AS key_name
  FROM user_api_key uak
  WHERE uak.key_hash = p_key_hash AND uak.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION touch_user_api_key(p_key_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE user_api_key
  SET last_used_at = now()
  WHERE id = p_key_id AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION resolve_agent_callback_token(p_token_hash text)
RETURNS TABLE(id uuid, user_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ca.id, ca.user_id
  FROM connected_agent ca
  WHERE ca.callback_token_hash = p_token_hash AND ca.enabled = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_user_api_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION touch_user_api_key(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_agent_callback_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_user_api_key(text) TO eigen_app;
GRANT EXECUTE ON FUNCTION touch_user_api_key(uuid) TO eigen_app;
GRANT EXECUTE ON FUNCTION resolve_agent_callback_token(text) TO eigen_app;

ALTER TABLE decision_shadow_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_shadow_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_shadow_log_isolation ON decision_shadow_log;
CREATE POLICY decision_shadow_log_isolation ON decision_shadow_log
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

-- Multiplayer board (0076_board_ideas_votes): the first deliberate cross-tenant read.
-- board_idea: readable by any signed-in session (hidden=false, not rejected); written only by its author
-- while Requested; protected columns via board_admin_update() (role checked server-side).
-- board_vote: owner-only for every operation; scores come from the board_scores() aggregate.
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
DROP TRIGGER IF EXISTS board_idea_guard_protected_columns ON "board_idea";
CREATE TRIGGER board_idea_guard_protected_columns
	BEFORE UPDATE ON "board_idea"
	FOR EACH ROW EXECUTE FUNCTION board_idea_guard_protected_columns();
ALTER TABLE "board_idea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_idea" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_idea_read_shared ON "board_idea";
CREATE POLICY board_idea_read_shared ON "board_idea"
	FOR SELECT
	USING (
		coalesce(current_setting('app.current_user_id', true), '') <> ''
		AND hidden = false AND status <> 'rejected'
	);
DROP POLICY IF EXISTS board_idea_insert_own ON "board_idea";
CREATE POLICY board_idea_insert_own ON "board_idea"
	FOR INSERT
	WITH CHECK (
		author_user_id = current_setting('app.current_user_id', true)
		AND status = 'requested' AND hidden = false AND planned = false
		AND maker_note IS NULL AND shipped_at IS NULL
	);
DROP POLICY IF EXISTS board_idea_update_own_requested ON "board_idea";
CREATE POLICY board_idea_update_own_requested ON "board_idea"
	FOR UPDATE
	USING (author_user_id = current_setting('app.current_user_id', true) AND status = 'requested')
	WITH CHECK (author_user_id = current_setting('app.current_user_id', true) AND status = 'requested');
DROP POLICY IF EXISTS board_idea_delete_own_requested ON "board_idea";
CREATE POLICY board_idea_delete_own_requested ON "board_idea"
	FOR DELETE
	USING (author_user_id = current_setting('app.current_user_id', true) AND status = 'requested');
ALTER TABLE "board_vote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_vote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_vote_own ON "board_vote";
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
	WHERE i.hidden = false AND i.status <> 'rejected'
		AND coalesce(current_setting('app.current_user_id', true), '') <> ''
	GROUP BY v.idea_id;
$$;
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
REVOKE ALL ON FUNCTION board_scores() FROM PUBLIC;
REVOKE ALL ON FUNCTION board_admin_update(uuid, text, boolean, text, boolean, boolean) FROM PUBLIC;
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "board_idea" TO eigen_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "board_vote" TO eigen_app;
		GRANT EXECUTE ON FUNCTION board_scores() TO eigen_app;
		GRANT EXECUTE ON FUNCTION board_admin_update(uuid, text, boolean, text, boolean, boolean) TO eigen_app;
	END IF;
END $$;
-- Earlier boots (search_path not pinned) created these in ag_catalog, where they shadow the
-- public copies for unqualified calls. The trigger above now points at public; drop the strays.
DROP FUNCTION IF EXISTS ag_catalog.board_scores();
DROP FUNCTION IF EXISTS ag_catalog.board_admin_update(uuid, text, boolean, text, boolean, boolean);
DROP FUNCTION IF EXISTS ag_catalog.board_idea_guard_protected_columns();
