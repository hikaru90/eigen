-- Long-text memory (Phase B): notes become searchable by meaning. A note (text_file) is chunked
-- into 3-5 sentence passages; each passage carries a 1536-d embedding (HNSW cosine) and a folded
-- lexical surface (GIN tsvector), exactly like thought. Passage text is stored encrypted like
-- text_file.body_text. RLS: see src/lib/server/db/enable_rls.sql (note_passage_isolation).
CREATE TABLE IF NOT EXISTS "note_passage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"text_file_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"text_encrypted" text NOT NULL,
	"lexical_text" text DEFAULT '' NOT NULL,
	"lexical_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("lexical_text", ''))) STORED NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_passage_user_id_user_id_fk') THEN
    ALTER TABLE "note_passage" ADD CONSTRAINT "note_passage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_passage_text_file_id_text_file_id_fk') THEN
    ALTER TABLE "note_passage" ADD CONSTRAINT "note_passage_text_file_id_text_file_id_fk" FOREIGN KEY ("text_file_id") REFERENCES "public"."text_file"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "note_passage_file_ordinal_idx" ON "note_passage" USING btree ("text_file_id","ordinal");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_passage_user_idx" ON "note_passage" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_passage_lexical_tsv_idx" ON "note_passage" USING gin ("lexical_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_passage_embedding_hnsw_idx" ON "note_passage" USING hnsw ("embedding" vector_cosine_ops);
