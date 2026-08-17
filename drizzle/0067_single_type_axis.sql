-- Single thought-type axis: collapse memoryType into ontology category.

-- 1. Add behavior flag to ontology kinds
ALTER TABLE "ontology_entity_kind" ADD COLUMN IF NOT EXISTS "never_stale" boolean DEFAULT false NOT NULL;

-- 2. Seed never_stale for durable thought categories (idempotent — default is false)
UPDATE "ontology_entity_kind" SET "never_stale" = true
  WHERE "kind_type" = 'thought_category'
    AND "key" IN ('decision', 'reference', 'goal', 'reflection', 'idea');

-- 3. Drop the second type label column — behavior now derives from category + ontology kind
ALTER TABLE "thought" DROP COLUMN IF EXISTS "memory_type";

-- 4. Remove the stale default that references a non-existent ontology key
ALTER TABLE "capture_session" ALTER COLUMN "category" DROP DEFAULT;
