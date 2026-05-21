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

ALTER TABLE user_ontology ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ontology FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_ontology_isolation ON user_ontology;
CREATE POLICY user_ontology_isolation ON user_ontology
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
