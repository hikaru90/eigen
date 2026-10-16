-- Per-item enforced decisions (docs/planning/09-jev-decision-plane.md §8 O1):
-- one decision_shadow_log row per mention/pair, keyed by a deterministic
-- surrogate ref (`m1`, `p2`, `t3` — 1-based order of the item in the decision
-- call). Never thought text, surfaces, or ids — the privacy contract of
-- decision-plane.ts holds.
ALTER TABLE "decision_shadow_log" ADD COLUMN IF NOT EXISTS "subject_ref" text;
