-- Archived notes (docs/planning/personamem-score-plan.md, S2b): forgetting a whole note must not
-- hard-delete it. A note with archived_at set stays in the database (restorable by clearing the
-- column) but leaves note search, note passages retrieval, the Notes list and the note tools.
-- NULL = active note; no default, so existing rows are unaffected.
ALTER TABLE "text_file" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
