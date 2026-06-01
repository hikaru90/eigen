-- Migration: 0021_temporal_memory
-- Temporal events (Postgres time-keeper) and graph_sync_job outbox for AGE Event nodes.

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "temporal_event" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"           text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "thought_id"        uuid        NOT NULL REFERENCES "thought"("id") ON DELETE CASCADE,
  "falkordb_node_id"  text,
  "kind"              text        NOT NULL,
  "active_period"     tsrange     NOT NULL,
  "time_precision"    text        NOT NULL,
  "timezone"          text        NOT NULL,
  "is_all_day"        boolean     NOT NULL DEFAULT false,
  "recurrence_rule"   text,
  "confidence"        real        NOT NULL,
  "semantic_summary"  text        NOT NULL,
  "embedding"         vector(1536),
  "lexical_text"      text        NOT NULL DEFAULT '',
  "lexical_tsv"       tsvector    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(lexical_text, ''))) STORED,
  "source_text_span"  text,
  "parse_metadata"    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "start_at"          timestamp,
  "end_at"            timestamp,
  "graph_sync_status" text        NOT NULL DEFAULT 'pending',
  "graph_sync_error"  text,
  "created_at"        timestamp   NOT NULL DEFAULT now(),
  "updated_at"        timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "temporal_event_user_idx"            ON "temporal_event" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "temporal_event_thought_idx"         ON "temporal_event" USING btree ("thought_id");
CREATE INDEX IF NOT EXISTS "temporal_event_active_period_idx" ON "temporal_event" USING gist ("active_period");
CREATE INDEX IF NOT EXISTS "temporal_event_lexical_tsv_idx"     ON "temporal_event" USING gin ("lexical_tsv");
CREATE INDEX IF NOT EXISTS "temporal_event_embedding_hnsw_idx"  ON "temporal_event" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "temporal_event_graph_sync_idx"      ON "temporal_event" USING btree ("user_id", "graph_sync_status");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "graph_sync_job" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"            text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "temporal_event_id"  uuid        REFERENCES "temporal_event"("id") ON DELETE CASCADE,
  "operation"          text        NOT NULL,
  "status"             text        NOT NULL DEFAULT 'pending',
  "payload"            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "attempt_count"      integer     NOT NULL DEFAULT 0,
  "last_error"         text,
  "created_at"         timestamp   NOT NULL DEFAULT now(),
  "updated_at"         timestamp   NOT NULL DEFAULT now(),
  "completed_at"       timestamp
);

CREATE INDEX IF NOT EXISTS "graph_sync_job_user_idx"            ON "graph_sync_job" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "graph_sync_job_status_idx"         ON "graph_sync_job" USING btree ("status", "created_at");
CREATE INDEX IF NOT EXISTS "graph_sync_job_temporal_event_idx" ON "graph_sync_job" USING btree ("temporal_event_id");
