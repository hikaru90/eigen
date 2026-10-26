-- "What Eigen knows about you" (docs/planning/user-facts-layer.md, F1): short statements about one
-- person (the user or someone in the user's life) derived by the enrich LLM from captures.
--
--   user_secure_value  personal identifiers (email, phone, address, licence plate, account/ID/policy
--                      numbers, date of birth): the VALUE lives here, tenant-encrypted. No embedding,
--                      no lexical surface, never selected into logs, tool results or LLM payloads.
--   user_fact          one fact: encrypted statement + the folded keyword surface and 1536-d embedding
--                      thoughts have. An identifier fact's statement holds only a [secure:<id>]
--                      reference; secure_value_id links the value.
--   user_fact_source   provenance: the capture thought (and the reference note, if the extractor was
--                      given its text) a fact was derived from. A fact with no live source is retired.
--
-- Statuses: active | superseded (replaced by a newer fact, kept as history) | forgotten (removed:
-- a forget request, or its last source was archived or edited away). RLS: enable_rls.sql.
CREATE TABLE IF NOT EXISTS "user_secure_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"subject_kind" text DEFAULT 'user' NOT NULL,
	"subject_label" text,
	"subject_entity_id" uuid,
	"statement_encrypted" text NOT NULL,
	"lexical_text" text DEFAULT '' NOT NULL,
	"lexical_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("lexical_text", ''))) STORED NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"kind" text NOT NULL,
	"confidence" real NOT NULL,
	"inferred" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"superseded_by" uuid,
	"as_of" timestamp NOT NULL,
	"secure_value_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_fact_subject_kind_check" CHECK ("subject_kind" IN ('user', 'person')),
	CONSTRAINT "user_fact_status_check" CHECK ("status" IN ('active', 'superseded', 'forgotten')),
	CONSTRAINT "user_fact_person_label_check" CHECK ("subject_kind" = 'user' OR "subject_label" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_fact_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fact_id" uuid NOT NULL,
	"thought_id" uuid,
	"text_file_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_fact_source_has_source_check" CHECK ("thought_id" IS NOT NULL OR "text_file_id" IS NOT NULL)
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secure_value_user_id_user_id_fk') THEN
    ALTER TABLE "user_secure_value" ADD CONSTRAINT "user_secure_value_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_user_id_user_id_fk') THEN
    ALTER TABLE "user_fact" ADD CONSTRAINT "user_fact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_subject_entity_id_canonical_entity_id_fk') THEN
    ALTER TABLE "user_fact" ADD CONSTRAINT "user_fact_subject_entity_id_canonical_entity_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."canonical_entity"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_superseded_by_user_fact_id_fk') THEN
    ALTER TABLE "user_fact" ADD CONSTRAINT "user_fact_superseded_by_user_fact_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."user_fact"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_secure_value_id_user_secure_value_id_fk') THEN
    ALTER TABLE "user_fact" ADD CONSTRAINT "user_fact_secure_value_id_user_secure_value_id_fk" FOREIGN KEY ("secure_value_id") REFERENCES "public"."user_secure_value"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_source_user_id_user_id_fk') THEN
    ALTER TABLE "user_fact_source" ADD CONSTRAINT "user_fact_source_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_source_fact_id_user_fact_id_fk') THEN
    ALTER TABLE "user_fact_source" ADD CONSTRAINT "user_fact_source_fact_id_user_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."user_fact"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_source_thought_id_thought_id_fk') THEN
    ALTER TABLE "user_fact_source" ADD CONSTRAINT "user_fact_source_thought_id_thought_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thought"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_fact_source_text_file_id_text_file_id_fk') THEN
    ALTER TABLE "user_fact_source" ADD CONSTRAINT "user_fact_source_text_file_id_text_file_id_fk" FOREIGN KEY ("text_file_id") REFERENCES "public"."text_file"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secure_value_user_idx" ON "user_secure_value" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_user_status_idx" ON "user_fact" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_subject_entity_idx" ON "user_fact" USING btree ("subject_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_secure_value_idx" ON "user_fact" USING btree ("secure_value_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_superseded_by_idx" ON "user_fact" USING btree ("superseded_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_lexical_tsv_idx" ON "user_fact" USING gin ("lexical_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_embedding_hnsw_idx" ON "user_fact" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_source_user_idx" ON "user_fact_source" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_source_fact_idx" ON "user_fact_source" USING btree ("fact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_source_thought_idx" ON "user_fact_source" USING btree ("thought_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_fact_source_text_file_idx" ON "user_fact_source" USING btree ("text_file_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_fact_source_fact_thought_uidx" ON "user_fact_source" USING btree ("fact_id","thought_id");
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "user_secure_value" TO eigen_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "user_fact" TO eigen_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "user_fact_source" TO eigen_app;
	END IF;
END $$;
