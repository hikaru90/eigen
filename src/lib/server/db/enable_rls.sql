-- Eigen: tenant RLS (user_id). Apply with `npm run db:rls` after `DATABASE_URL` is set.
-- App requests set GUC on the pooled connection: set_config('app.current_user_id', <id>, false) — see src/hooks.server.ts.

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

ALTER TABLE project_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_profile FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_profile_isolation ON project_profile;
CREATE POLICY project_profile_isolation ON project_profile
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

-- Bearer API key auth runs before app.current_user_id is set; resolve via SECURITY DEFINER.
CREATE OR REPLACE FUNCTION resolve_user_api_key(p_key_hash text)
RETURNS TABLE(id uuid, user_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT uak.id, uak.user_id
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

REVOKE ALL ON FUNCTION resolve_user_api_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION touch_user_api_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_user_api_key(text) TO eigen_app;
GRANT EXECUTE ON FUNCTION touch_user_api_key(uuid) TO eigen_app;
