CREATE TABLE IF NOT EXISTS "canonical_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"canonical_key" text NOT NULL,
	"label" text NOT NULL,
	"entity_type" text DEFAULT 'other' NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"canonical_entity_id" uuid NOT NULL,
	"alias_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_resolution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"thought_id" uuid NOT NULL,
	"mention_surface" text NOT NULL,
	"canonical_entity_id" uuid,
	"decision" text NOT NULL,
	"confidence" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ontology_entity_kind" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ontology_relation_kind" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"meaning" text NOT NULL,
	"from_ontology_entity_kind_id" uuid NOT NULL,
	"to_ontology_entity_kind_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retrieval_quality_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"surface" text NOT NULL,
	"retrieval_version" text DEFAULT '1' NOT NULL,
	"top_k" integer NOT NULL,
	"weight_vector" double precision NOT NULL,
	"weight_graph" double precision NOT NULL,
	"result_count" integer NOT NULL,
	"top1_semantic_share" double precision NOT NULL,
	"topk_mean_semantic_share" double precision NOT NULL,
	"top1_primary_channel" text NOT NULL,
	"graph_only_in_topk_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_ontology" (
	"user_id" text PRIMARY KEY NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_up_to_thought_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "ontology_entity_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "thought_relation" ADD COLUMN IF NOT EXISTS "ontology_relation_kind_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canonical_entity_user_id_user_id_fk') THEN
    ALTER TABLE "canonical_entity" ADD CONSTRAINT "canonical_entity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_alias_user_id_user_id_fk') THEN
    ALTER TABLE "entity_alias" ADD CONSTRAINT "entity_alias_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_alias_canonical_entity_id_canonical_entity_id_fk') THEN
    ALTER TABLE "entity_alias" ADD CONSTRAINT "entity_alias_canonical_entity_id_canonical_entity_id_fk" FOREIGN KEY ("canonical_entity_id") REFERENCES "public"."canonical_entity"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_resolution_log_user_id_user_id_fk') THEN
    ALTER TABLE "entity_resolution_log" ADD CONSTRAINT "entity_resolution_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_resolution_log_thought_id_thought_id_fk') THEN
    ALTER TABLE "entity_resolution_log" ADD CONSTRAINT "entity_resolution_log_thought_id_thought_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thought"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_resolution_log_canonical_entity_id_canonical_entity_id_fk') THEN
    ALTER TABLE "entity_resolution_log" ADD CONSTRAINT "entity_resolution_log_canonical_entity_id_canonical_entity_id_fk" FOREIGN KEY ("canonical_entity_id") REFERENCES "public"."canonical_entity"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_entity_kind_user_id_user_id_fk') THEN
    ALTER TABLE "ontology_entity_kind" ADD CONSTRAINT "ontology_entity_kind_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_relation_kind_user_id_user_id_fk') THEN
    ALTER TABLE "ontology_relation_kind" ADD CONSTRAINT "ontology_relation_kind_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_relation_kind_from_ontology_entity_kind_id_ontology_entity_kind_id_fk') THEN
    ALTER TABLE "ontology_relation_kind" ADD CONSTRAINT "ontology_relation_kind_from_ontology_entity_kind_id_ontology_entity_kind_id_fk" FOREIGN KEY ("from_ontology_entity_kind_id") REFERENCES "public"."ontology_entity_kind"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_relation_kind_to_ontology_entity_kind_id_ontology_entity_kind_id_fk') THEN
    ALTER TABLE "ontology_relation_kind" ADD CONSTRAINT "ontology_relation_kind_to_ontology_entity_kind_id_ontology_entity_kind_id_fk" FOREIGN KEY ("to_ontology_entity_kind_id") REFERENCES "public"."ontology_entity_kind"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retrieval_quality_event_user_id_user_id_fk') THEN
    ALTER TABLE "retrieval_quality_event" ADD CONSTRAINT "retrieval_quality_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_ontology_user_id_user_id_fk') THEN
    ALTER TABLE "user_ontology" ADD CONSTRAINT "user_ontology_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_entity_user_idx" ON "canonical_entity" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canonical_entity_user_canonical_uidx" ON "canonical_entity" USING btree ("user_id","canonical_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_entity_embedding_hnsw_idx" ON "canonical_entity" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_alias_user_idx" ON "entity_alias" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_alias_canonical_idx" ON "entity_alias" USING btree ("canonical_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_alias_user_surface_uidx" ON "entity_alias" USING btree ("user_id","alias_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_resolution_log_user_idx" ON "entity_resolution_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_resolution_log_thought_idx" ON "entity_resolution_log" USING btree ("thought_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_entity_kind_user_key_uidx" ON "ontology_entity_kind" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_entity_kind_user_idx" ON "ontology_entity_kind" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_relation_kind_user_key_uidx" ON "ontology_relation_kind" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_relation_kind_user_idx" ON "ontology_relation_kind" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_relation_kind_from_idx" ON "ontology_relation_kind" USING btree ("from_ontology_entity_kind_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_relation_kind_to_idx" ON "ontology_relation_kind" USING btree ("to_ontology_entity_kind_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retrieval_quality_event_user_idx" ON "retrieval_quality_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retrieval_quality_event_user_created_idx" ON "retrieval_quality_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_ontology_updated_idx" ON "user_ontology" USING btree ("updated_at");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_ontology_entity_kind_id_ontology_entity_kind_id_fk') THEN
    ALTER TABLE "thought" ADD CONSTRAINT "thought_ontology_entity_kind_id_ontology_entity_kind_id_fk" FOREIGN KEY ("ontology_entity_kind_id") REFERENCES "public"."ontology_entity_kind"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_relation_ontology_relation_kind_id_ontology_relation_kind_id_fk') THEN
    ALTER TABLE "thought_relation" ADD CONSTRAINT "thought_relation_ontology_relation_kind_id_ontology_relation_kind_id_fk" FOREIGN KEY ("ontology_relation_kind_id") REFERENCES "public"."ontology_relation_kind"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thought_ontology_entity_kind_idx" ON "thought" USING btree ("ontology_entity_kind_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thought_relation_ontology_kind_idx" ON "thought_relation" USING btree ("ontology_relation_kind_id");