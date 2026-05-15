-- Migration: 0011_memory_system_v2
-- Adds memory lifecycle columns to `thought` and creates the GraphRAG community
-- detection tables (graph_community, community_member, community_summary) and the
-- ontology proposal table. Uses IF NOT EXISTS / IF NOT EXISTS guards throughout so
-- re-running is safe on any DB state.

--> statement-breakpoint

-- 1. New columns on `thought` (all use IF NOT EXISTS; safe on fresh install).
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "memory_type"          text;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "cues"                 text[]  NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "salience_score"       real    NOT NULL DEFAULT 1.0;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "access_count"         integer NOT NULL DEFAULT 0;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "last_accessed_at"     timestamp;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "enriched_at"          timestamp;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "enrichment_version"   integer NOT NULL DEFAULT 0;

--> statement-breakpoint

-- 2. GIN index on cues array for lexical search diversification.
CREATE INDEX IF NOT EXISTS "thought_cues_gin_idx"    ON "thought" USING gin  ("cues");
CREATE INDEX IF NOT EXISTS "thought_salience_idx"    ON "thought" USING btree ("user_id", "salience_score");
CREATE INDEX IF NOT EXISTS "thought_enriched_idx"    ON "thought" USING btree ("user_id", "enriched_at");

--> statement-breakpoint

-- 3. llm_active_provider and llm_provider_config already created in 0009 (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "llm_provider_config" (
  "user_id"          text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "provider"         text        NOT NULL,
  "base_url"         text        NOT NULL,
  "api_key"          text        NOT NULL,
  "rule_chat"        text,
  "rule_embedding"   text,
  "model_chat"       text,
  "model_embedding"  text,
  "updated_at"       timestamp   NOT NULL DEFAULT now(),
  CONSTRAINT "llm_provider_config_pk" PRIMARY KEY ("user_id", "provider")
);

CREATE TABLE IF NOT EXISTS "llm_active_provider" (
  "user_id"     text      PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "provider"    text      NOT NULL DEFAULT 'eurouter',
  "updated_at"  timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint

-- 4. kind_type already added in 0010 (IF NOT EXISTS).
ALTER TABLE "ontology_entity_kind" ADD COLUMN IF NOT EXISTS "kind_type" text NOT NULL DEFAULT 'thought_category';

-- Ensure the unique constraint and indexes exist (idempotent).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ontology_entity_kind_user_key_uidx'
  ) THEN
    ALTER TABLE "ontology_entity_kind" ADD CONSTRAINT "ontology_entity_kind_user_key_uidx" UNIQUE("user_id", "key");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ontology_entity_kind_kind_type_idx" ON "ontology_entity_kind" USING btree ("user_id", "kind_type");

--> statement-breakpoint

-- 5. GraphRAG community tables (new).
CREATE TABLE IF NOT EXISTS "graph_community" (
  "id"                  uuid      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"             text      NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "level"               integer   NOT NULL,
  "parent_community_id" uuid,
  "member_count"        integer   NOT NULL DEFAULT 0,
  "detected_at"         timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "graph_community_user_idx"       ON "graph_community" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "graph_community_user_level_idx" ON "graph_community" USING btree ("user_id", "level");
CREATE INDEX IF NOT EXISTS "graph_community_parent_idx"     ON "graph_community" USING btree ("parent_community_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "community_member" (
  "community_id"        uuid NOT NULL REFERENCES "graph_community"("id") ON DELETE CASCADE,
  "canonical_entity_id" uuid NOT NULL REFERENCES "canonical_entity"("id") ON DELETE CASCADE,
  "user_id"             text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "community_member_pk" PRIMARY KEY ("community_id", "canonical_entity_id")
);

CREATE INDEX IF NOT EXISTS "community_member_entity_idx" ON "community_member" USING btree ("canonical_entity_id");
CREATE INDEX IF NOT EXISTS "community_member_user_idx"   ON "community_member" USING btree ("user_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "community_summary" (
  "id"               uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"          text    NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "community_id"     uuid    NOT NULL REFERENCES "graph_community"("id") ON DELETE CASCADE,
  "level"            integer NOT NULL,
  "summary_text"     text    NOT NULL,
  "summary_embedding" vector(1536),
  "entity_count"     integer NOT NULL DEFAULT 0,
  "thought_count"    integer NOT NULL DEFAULT 0,
  "generated_at"     timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "community_summary_community_uidx" UNIQUE ("community_id")
);

CREATE INDEX IF NOT EXISTS "community_summary_user_idx"        ON "community_summary" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "community_summary_user_level_idx"  ON "community_summary" USING btree ("user_id", "level");
CREATE INDEX IF NOT EXISTS "community_summary_community_idx"   ON "community_summary" USING btree ("community_id");
CREATE INDEX IF NOT EXISTS "community_summary_embedding_hnsw_idx" ON "community_summary" USING hnsw ("summary_embedding" vector_cosine_ops);

--> statement-breakpoint

-- 6. Ontology proposals table (new).
CREATE TABLE IF NOT EXISTS "ontology_proposal" (
  "id"              uuid   PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"         text   NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "key"             text   NOT NULL,
  "name"            text   NOT NULL,
  "definition"      text   NOT NULL,
  "evidence_count"  integer NOT NULL DEFAULT 0,
  "frequency_score" real    NOT NULL DEFAULT 0,
  "status"          text    NOT NULL DEFAULT 'candidate',
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "updated_at"      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ontology_proposal_user_key_uidx" UNIQUE ("user_id", "key")
);

CREATE INDEX IF NOT EXISTS "ontology_proposal_user_idx"        ON "ontology_proposal" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "ontology_proposal_user_status_idx" ON "ontology_proposal" USING btree ("user_id", "status");
