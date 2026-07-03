-- Unified lifecycle on thought; fold temporal cancelled/dismissed into archived.

ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "lifecycle_status" text NOT NULL DEFAULT 'open';
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "lifecycle_updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "lifecycle_completed_at" timestamp;

UPDATE "thought"
SET
	"lifecycle_status" = CASE
		WHEN metadata->>'status' = 'completed' THEN 'completed'
		WHEN metadata->>'status' = 'archived' THEN 'archived'
		ELSE 'open'
	END,
	"lifecycle_completed_at" = CASE
		WHEN metadata->>'status' = 'completed' AND metadata->>'completedAt' IS NOT NULL
			THEN (metadata->>'completedAt')::timestamp
		ELSE NULL
	END,
	"lifecycle_updated_at" = COALESCE("updated_at", now())
WHERE metadata->>'status' IS NOT NULL;

CREATE INDEX IF NOT EXISTS "thought_lifecycle_idx" ON "thought" ("user_id", "lifecycle_status");

UPDATE "temporal_event"
SET "lifecycle_status" = 'archived'
WHERE "lifecycle_status" IN ('cancelled', 'dismissed');
