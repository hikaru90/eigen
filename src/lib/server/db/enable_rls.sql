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
