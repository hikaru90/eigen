-- Generalize the decision-model shadow log for the multi-question decision
-- plane (docs/planning/09-jev-decision-plane.md): one row per decision kind
-- (category | content_role | entity_type — chat surfaces follow in S3).
-- Category-specific column names become kind-neutral; every existing row is a
-- category row and keeps its meaning under the default decision_kind.
ALTER TABLE "decision_shadow_log" ADD COLUMN "decision_kind" text NOT NULL DEFAULT 'category';
ALTER TABLE "decision_shadow_log" RENAME COLUMN "llm_category" TO "llm_choice";
ALTER TABLE "decision_shadow_log" RENAME COLUMN "decision_category" TO "decision_choice";

-- Defense-in-depth (assessment 2026-07-22 S2): the table stores per-user
-- diagnostics but had no RLS policy at all. Mirror the enable_rls.sql pattern;
-- the same policy is added to enable_rls.sql for `npm run db:rls` parity.
ALTER TABLE "decision_shadow_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_shadow_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_shadow_log_isolation ON "decision_shadow_log";
CREATE POLICY decision_shadow_log_isolation ON "decision_shadow_log"
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));
