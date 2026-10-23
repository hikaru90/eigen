-- Suggested questions on Ask (docs/planning/feature-ask-suggested-questions.md, SQ-3).
-- One natural question per enriched thought, written by the single enrich_thought_bundle
-- LLM call. Plaintext + tenant-envelope ciphertext, same at-rest pattern as raw/normalized
-- text. Existing RLS on "thought" covers both columns. No backfill (decision D1).
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "ask_question" text;--> statement-breakpoint
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "ask_question_encrypted" text;
