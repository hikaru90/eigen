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

ALTER TABLE llm_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_config_isolation ON llm_config;
CREATE POLICY llm_config_isolation ON llm_config
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));
