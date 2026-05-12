-- One-time data repair: legacy capture slugs (thought/task/idea/reference/date/person) →
-- first active ontology entity kind per user (prefers key `perception` when present).
--
-- Run this BEFORE applying Drizzle migrations that add composite FKs on
-- (user_id, category) → ontology_entity_kind (see drizzle/0006_* and drizzle/0007_*),
-- or migration will fail on orphan categories.

UPDATE thought AS t
SET
	category = pick.kind_key,
	ontology_entity_kind_id = pick.kind_id
FROM (
	SELECT
		t2.id AS thought_id,
		k.id AS kind_id,
		k.key AS kind_key
	FROM thought t2
	INNER JOIN LATERAL (
		SELECT id, key
		FROM ontology_entity_kind
		WHERE user_id = t2.user_id AND active = true
		ORDER BY CASE WHEN key = 'perception' THEN 0 ELSE 1 END, key
		LIMIT 1
	) k ON true
	WHERE t2.category IN ('thought', 'task', 'idea', 'reference', 'date', 'person')
) AS pick
WHERE t.id = pick.thought_id;

UPDATE thought AS t
SET ontology_entity_kind_id = k.id
FROM ontology_entity_kind k
WHERE k.user_id = t.user_id AND k.active = true AND k.key = t.category AND t.ontology_entity_kind_id IS NULL;

UPDATE capture_session AS c
SET category = pick.kind_key
FROM (
	SELECT
		c2.id AS session_id,
		k.key AS kind_key
	FROM capture_session c2
	INNER JOIN LATERAL (
		SELECT key
		FROM ontology_entity_kind
		WHERE user_id = c2.user_id AND active = true
		ORDER BY CASE WHEN key = 'perception' THEN 0 ELSE 1 END, key
		LIMIT 1
	) k ON true
	WHERE c2.category IN ('thought', 'task', 'idea', 'reference', 'date', 'person')
) AS pick
WHERE c.id = pick.session_id;

ALTER TABLE capture_session ALTER COLUMN category SET DEFAULT 'perception';
