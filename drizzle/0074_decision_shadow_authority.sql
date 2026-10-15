-- Decision-model promotion (docs/planning/09-jev-decision-plane.md §6 P):
-- when a decision kind is enforced (DECISION_ENFORCE_KINDS), the decision
-- model's answer is authoritative and the chat judge becomes the comparison.
-- Each row records which engine owns the kind, and the chat judge's choice
-- becomes optional — it is absent when enforcement skips the chat call
-- entirely (content_role=thought_only no longer runs the split LLM call).
ALTER TABLE "decision_shadow_log" ADD COLUMN "authoritative_engine" text NOT NULL DEFAULT 'chat_judge';
ALTER TABLE "decision_shadow_log" ALTER COLUMN "llm_choice" DROP NOT NULL;
