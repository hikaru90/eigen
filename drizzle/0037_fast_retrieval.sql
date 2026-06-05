-- Fast retrieval: materialized link tables, community bundles, precomputed thought features.

ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "rerank_snippet" text;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "primary_community_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "entity_centrality_max" real DEFAULT 0 NOT NULL;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "specificity_score" real DEFAULT 0 NOT NULL;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "recency_bucket" real DEFAULT 0 NOT NULL;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "bundle_rank" real DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "thought_entity" (
	"thought_id" uuid NOT NULL REFERENCES "thought"("id") ON DELETE CASCADE,
	"entity_id" uuid NOT NULL REFERENCES "canonical_entity"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"salience" real DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thought_entity_pk" PRIMARY KEY("thought_id","entity_id")
);
CREATE INDEX IF NOT EXISTS "thought_entity_user_idx" ON "thought_entity" ("user_id");
CREATE INDEX IF NOT EXISTS "thought_entity_entity_idx" ON "thought_entity" ("entity_id");

CREATE TABLE IF NOT EXISTS "thought_neighbor" (
	"thought_id" uuid NOT NULL REFERENCES "thought"("id") ON DELETE CASCADE,
	"neighbor_id" uuid NOT NULL REFERENCES "thought"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"weight" real DEFAULT 1 NOT NULL,
	"relation_type" text NOT NULL DEFAULT 'RELATES_TO',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thought_neighbor_pk" PRIMARY KEY("thought_id","neighbor_id")
);
CREATE INDEX IF NOT EXISTS "thought_neighbor_user_idx" ON "thought_neighbor" ("user_id");
CREATE INDEX IF NOT EXISTS "thought_neighbor_neighbor_idx" ON "thought_neighbor" ("neighbor_id");

CREATE TABLE IF NOT EXISTS "entity_top_thoughts" (
	"entity_id" uuid PRIMARY KEY REFERENCES "canonical_entity"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"thought_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
	"ranks" real[] NOT NULL DEFAULT ARRAY[]::real[],
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_top_thoughts_user_idx" ON "entity_top_thoughts" ("user_id");

CREATE TABLE IF NOT EXISTS "community_bundle" (
	"community_id" uuid PRIMARY KEY REFERENCES "graph_community"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"level" integer NOT NULL,
	"top_thought_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
	"top_entity_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
	"adjacent_community_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
	"payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "community_bundle_user_idx" ON "community_bundle" ("user_id");
CREATE INDEX IF NOT EXISTS "community_bundle_user_level_idx" ON "community_bundle" ("user_id", "level");

ALTER TABLE "community_summary" ADD COLUMN IF NOT EXISTS "summary_short" text;
ALTER TABLE "graph_community" ADD COLUMN IF NOT EXISTS "dirty_at" timestamp;
