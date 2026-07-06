-- Repair thoughts where metadata.status was updated without syncing lifecycle_status
-- (e.g. text+status edits before lifecycle column sync). Encrypted rows are fixed on next edit.

UPDATE "thought"
SET
	"lifecycle_status" = CASE
		WHEN metadata->>'status' = 'completed' THEN 'completed'
		WHEN metadata->>'status' = 'archived' THEN 'archived'
		ELSE "lifecycle_status"
	END,
	"lifecycle_completed_at" = CASE
		WHEN metadata->>'status' = 'completed' AND metadata->>'completedAt' IS NOT NULL
			THEN (metadata->>'completedAt')::timestamp
		WHEN metadata->>'status' = 'completed' AND "lifecycle_completed_at" IS NULL
			THEN COALESCE("updated_at", now())
		ELSE "lifecycle_completed_at"
	END,
	"lifecycle_updated_at" = COALESCE("updated_at", now())
WHERE "lifecycle_status" = 'open'
	AND metadata->>'status' IN ('completed', 'archived');
