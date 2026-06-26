CREATE TABLE IF NOT EXISTS "text_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body_text" text NOT NULL,
	"body_text_encrypted" text,
	"lexical_text" text DEFAULT '' NOT NULL,
	"lexical_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("lexical_text", ''))) STORED NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thought_text_file" (
	"user_id" text NOT NULL,
	"thought_id" uuid NOT NULL,
	"text_file_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thought_text_file_pk" PRIMARY KEY("thought_id","text_file_id")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'text_file_user_id_user_id_fk') THEN
    ALTER TABLE "text_file" ADD CONSTRAINT "text_file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_text_file_user_id_user_id_fk') THEN
    ALTER TABLE "thought_text_file" ADD CONSTRAINT "thought_text_file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_text_file_thought_id_thought_id_fk') THEN
    ALTER TABLE "thought_text_file" ADD CONSTRAINT "thought_text_file_thought_id_thought_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thought"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_text_file_text_file_id_text_file_id_fk') THEN
    ALTER TABLE "thought_text_file" ADD CONSTRAINT "thought_text_file_text_file_id_text_file_id_fk" FOREIGN KEY ("text_file_id") REFERENCES "public"."text_file"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_file_user_updated_idx" ON "text_file" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_file_lexical_tsv_idx" ON "text_file" USING gin ("lexical_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thought_text_file_user_idx" ON "thought_text_file" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thought_text_file_text_file_idx" ON "thought_text_file" USING btree ("text_file_id");
