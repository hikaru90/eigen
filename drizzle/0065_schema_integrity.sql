-- Integrity: missing FKs + drop unused scaffold `task` table.

-- graph_community hierarchy
ALTER TABLE "graph_community"
	DROP CONSTRAINT IF EXISTS "graph_community_parent_community_id_fk";
ALTER TABLE "graph_community"
	ADD CONSTRAINT "graph_community_parent_community_id_fk"
	FOREIGN KEY ("parent_community_id") REFERENCES "graph_community"("id") ON DELETE SET NULL;

-- eval entry dependency DAG
ALTER TABLE "eval_entry"
	DROP CONSTRAINT IF EXISTS "eval_entry_depends_on_entry_id_fk";
ALTER TABLE "eval_entry"
	ADD CONSTRAINT "eval_entry_depends_on_entry_id_fk"
	FOREIGN KEY ("depends_on_entry_id") REFERENCES "eval_entry"("id") ON DELETE SET NULL;

-- Drop orphan fixture→thought maps before enforcing FK (thoughts may have been deleted).
DELETE FROM "eval_thought_map" etm
WHERE NOT EXISTS (
	SELECT 1 FROM "thought" t WHERE t.id = etm.thought_id
);

ALTER TABLE "eval_thought_map"
	DROP CONSTRAINT IF EXISTS "eval_thought_map_thought_id_fk";
ALTER TABLE "eval_thought_map"
	ADD CONSTRAINT "eval_thought_map_thought_id_fk"
	FOREIGN KEY ("thought_id") REFERENCES "thought"("id") ON DELETE CASCADE;

-- Unused Better Auth / drizzle bootstrap leftover (no app references).
DROP TABLE IF EXISTS "task";
