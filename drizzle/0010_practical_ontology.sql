-- Migration: 0010_practical_ontology
-- Adds kind_type discriminator to ontology_entity_kind and migrates users from
-- the cognitive baseline ontology to the practical thought + entity type ontology.
--
-- Thought category mapping (cognitive → practical):
--   perception  → observation
--   emotion     → feeling
--   belief      → reference
--   memory      → memory      (unchanged)
--   desire      → goal
--   intention   → task
--   attention   → observation
--   imagination → idea
--   judgment    → reflection
--   worry       → feeling
--
-- All canonical_entity rows with a cognitive entity_type get remapped to 'concept'.

--> statement-breakpoint

-- 1. Add kind_type column (thought_category | entity_type); default covers all existing rows.
ALTER TABLE "ontology_entity_kind"
  ADD COLUMN IF NOT EXISTS "kind_type" text NOT NULL DEFAULT 'thought_category';

ALTER TABLE "ontology_entity_kind"
  DROP CONSTRAINT IF EXISTS "ontology_entity_kind_kind_type_check";

ALTER TABLE "ontology_entity_kind"
  ADD CONSTRAINT "ontology_entity_kind_kind_type_check"
  CHECK ("kind_type" IN ('thought_category', 'entity_type'));

CREATE INDEX IF NOT EXISTS "ontology_entity_kind_kind_type_idx"
  ON "ontology_entity_kind" ("user_id", "kind_type");

--> statement-breakpoint

-- 2. Insert new practical thought category kinds for users who have cognitive ontology rows.
--    'memory' is excluded because it already exists with the same key.
WITH cog_users AS (
  SELECT DISTINCT user_id
  FROM "ontology_entity_kind"
  WHERE key IN ('perception','emotion','belief','desire','intention','attention','imagination','judgment','worry')
)
INSERT INTO "ontology_entity_kind" (user_id, key, name, definition, active, kind_type)
SELECT
  u.user_id,
  nk.key,
  nk.name,
  nk.definition,
  true,
  'thought_category'
FROM cog_users u
CROSS JOIN (VALUES
  ('task',        'Task',        'Something to do, an action item, or work in progress'),
  ('idea',        'Idea',        'A creative, generative, or speculative thought'),
  ('observation', 'Observation', 'Something noticed or perceived in the world'),
  ('decision',    'Decision',    'A choice made or actively being weighed'),
  ('goal',        'Goal',        'A desired outcome, aspiration, or longer-term intention'),
  ('feeling',     'Feeling',     'An emotional state or affective reaction'),
  ('question',    'Question',    'Something to understand, research, or resolve'),
  ('reference',   'Reference',   'A fact, link, resource, or piece of information to store'),
  ('reflection',  'Reflection',  'Introspection or meta-thinking about one''s own patterns')
) AS nk(key, name, definition)
ON CONFLICT (user_id, key) DO NOTHING;

-- Also update the existing 'memory' kind definition and kind_type for cognitive users
UPDATE "ontology_entity_kind"
SET definition = 'A record of past experience', kind_type = 'thought_category'
WHERE key = 'memory';

--> statement-breakpoint

-- 3. Insert entity type kinds for all users that have any ontology rows.
WITH all_users AS (
  SELECT DISTINCT user_id FROM "ontology_entity_kind"
)
INSERT INTO "ontology_entity_kind" (user_id, key, name, definition, active, kind_type)
SELECT
  u.user_id,
  et.key,
  et.name,
  et.definition,
  true,
  'entity_type'
FROM all_users u
CROSS JOIN (VALUES
  ('person',        'Person',        'A human being'),
  ('place',         'Place',         'A physical or digital location'),
  ('organization',  'Organization',  'A company, team, community, or institution'),
  ('project',       'Project',       'A body of work or initiative'),
  ('technology',    'Technology',    'A software tool, framework, hardware, or system'),
  ('event',         'Event',         'A time-bounded occurrence'),
  ('concept',       'Concept',       'An abstract idea, topic, domain, or framework'),
  ('artifact',      'Artifact',      'A document, file, design, book, or other created object')
) AS et(key, name, definition)
ON CONFLICT (user_id, key) DO NOTHING;

--> statement-breakpoint

-- 4. Remap thought.category from cognitive keys to practical keys.
--    The new practical kinds must already exist (step 2) before updating thoughts.
UPDATE "thought" AS t
SET
  category = CASE t.category
    WHEN 'perception'  THEN 'observation'
    WHEN 'emotion'     THEN 'feeling'
    WHEN 'belief'      THEN 'reference'
    WHEN 'desire'      THEN 'goal'
    WHEN 'intention'   THEN 'task'
    WHEN 'attention'   THEN 'observation'
    WHEN 'imagination' THEN 'idea'
    WHEN 'judgment'    THEN 'reflection'
    WHEN 'worry'       THEN 'feeling'
    ELSE t.category
  END,
  ontology_entity_kind_id = (
    SELECT id FROM "ontology_entity_kind"
    WHERE user_id = t.user_id
      AND kind_type = 'thought_category'
      AND active = true
      AND key = CASE t.category
        WHEN 'perception'  THEN 'observation'
        WHEN 'emotion'     THEN 'feeling'
        WHEN 'belief'      THEN 'reference'
        WHEN 'desire'      THEN 'goal'
        WHEN 'intention'   THEN 'task'
        WHEN 'attention'   THEN 'observation'
        WHEN 'imagination' THEN 'idea'
        WHEN 'judgment'    THEN 'reflection'
        WHEN 'worry'       THEN 'feeling'
        ELSE t.category
      END
    LIMIT 1
  )
WHERE t.category IN ('perception','emotion','belief','desire','intention','attention','imagination','judgment','worry');

--> statement-breakpoint

-- 5. Remap capture_session.category from cognitive keys to practical keys.
UPDATE "capture_session"
SET category = CASE category
  WHEN 'perception'  THEN 'observation'
  WHEN 'emotion'     THEN 'feeling'
  WHEN 'belief'      THEN 'reference'
  WHEN 'desire'      THEN 'goal'
  WHEN 'intention'   THEN 'task'
  WHEN 'attention'   THEN 'observation'
  WHEN 'imagination' THEN 'idea'
  WHEN 'judgment'    THEN 'reflection'
  WHEN 'worry'       THEN 'feeling'
  ELSE category
END
WHERE category IN ('perception','emotion','belief','desire','intention','attention','imagination','judgment','worry');

-- Also update the capture_session default value
ALTER TABLE "capture_session" ALTER COLUMN "category" SET DEFAULT 'task';

--> statement-breakpoint

-- 6. Deactivate old cognitive kinds (NOT 'memory' — it maps to itself).
UPDATE "ontology_entity_kind"
SET active = false
WHERE key IN ('perception','emotion','belief','desire','intention','attention','imagination','judgment','worry')
  AND kind_type = 'thought_category';

--> statement-breakpoint

-- 7. Deactivate old cognitive relation kinds whose endpoints are now deactivated.
UPDATE "ontology_relation_kind"
SET active = false
WHERE from_ontology_entity_kind_id IN (
  SELECT id FROM "ontology_entity_kind"
  WHERE key IN ('perception','emotion','belief','desire','intention','attention','imagination','judgment','worry')
    AND kind_type = 'thought_category'
    AND active = false
)
OR to_ontology_entity_kind_id IN (
  SELECT id FROM "ontology_entity_kind"
  WHERE key IN ('perception','emotion','belief','desire','intention','attention','imagination','judgment','worry')
    AND kind_type = 'thought_category'
    AND active = false
);

--> statement-breakpoint

-- 8. Insert new practical relation kinds for users who have the new practical thought categories.
--    Uses ON CONFLICT DO UPDATE to handle key collisions (e.g. 'leads_to', 'motivates' existed in cognitive).
WITH users_with_practical AS (
  SELECT DISTINCT user_id
  FROM "ontology_entity_kind"
  WHERE key = 'task' AND kind_type = 'thought_category' AND active = true
),
kind_map AS (
  SELECT user_id, key, id
  FROM "ontology_entity_kind"
  WHERE kind_type = 'thought_category' AND active = true
    AND key IN ('task','idea','observation','decision','goal','feeling','question','reference','memory','reflection')
)
INSERT INTO "ontology_relation_kind" (user_id, key, meaning, from_ontology_entity_kind_id, to_ontology_entity_kind_id, active)
SELECT
  u.user_id,
  r.rkey,
  r.meaning,
  from_k.id,
  to_k.id,
  true
FROM users_with_practical u
CROSS JOIN (VALUES
  ('leads_to',     'An idea crystallizes into an action',       'idea',        'task'),
  ('motivates',    'A goal drives concrete tasks',              'goal',        'task'),
  ('informs',      'What you notice shapes choices',            'observation', 'decision'),
  ('supports',     'Facts or data back a decision',             'reference',   'decision'),
  ('triggered_by', 'A feeling arises from something noticed',   'feeling',     'observation'),
  ('recalls',      'A memory evokes an emotional response',     'memory',      'feeling'),
  ('refines',      'One idea sharpens another',                 'idea',        'idea'),
  ('resolves',     'Completing work answers a question',        'task',        'question'),
  ('clarifies',    'Introspection resolves a question',         'reflection',  'question'),
  ('emerges_from', 'A decision crystallizes into a commitment', 'decision',    'goal')
) AS r(rkey, meaning, from_key, to_key)
JOIN kind_map from_k ON from_k.user_id = u.user_id AND from_k.key = r.from_key
JOIN kind_map to_k   ON to_k.user_id   = u.user_id AND to_k.key   = r.to_key
ON CONFLICT (user_id, key) DO UPDATE
  SET meaning                      = EXCLUDED.meaning,
      from_ontology_entity_kind_id = EXCLUDED.from_ontology_entity_kind_id,
      to_ontology_entity_kind_id   = EXCLUDED.to_ontology_entity_kind_id,
      active                       = true;

--> statement-breakpoint

-- 9. Remap canonical_entity.entity_type from cognitive keys to 'concept'.
--    Cognitive keys were semantically wrong for entities; 'concept' is a safe default
--    that will self-correct on the next mention capture.
UPDATE "canonical_entity"
SET entity_type = 'concept'
WHERE entity_type IN (
  'perception','emotion','belief','memory','desire','intention',
  'attention','imagination','judgment','worry','other'
);
