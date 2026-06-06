-- Tiered capture: queue status for background enrich worker.

ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "enrich_queue_status" text;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "enrich_queue_error" text;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "capture_source" text;

CREATE INDEX IF NOT EXISTS "thought_enrich_queue_idx" ON "thought" ("user_id", "enrich_queue_status");
