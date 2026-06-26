CREATE TABLE IF NOT EXISTS "project_profile" (
	"user_id" text NOT NULL,
	"project_entity_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_action_thought_id" uuid,
	"designated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_profile_pk" PRIMARY KEY("user_id","project_entity_id")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_profile_user_id_user_id_fk') THEN
    ALTER TABLE "project_profile" ADD CONSTRAINT "project_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_profile_project_entity_id_canonical_entity_id_fk') THEN
    ALTER TABLE "project_profile" ADD CONSTRAINT "project_profile_project_entity_id_canonical_entity_id_fk" FOREIGN KEY ("project_entity_id") REFERENCES "public"."canonical_entity"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_profile_next_action_thought_id_thought_id_fk') THEN
    ALTER TABLE "project_profile" ADD CONSTRAINT "project_profile_next_action_thought_id_thought_id_fk" FOREIGN KEY ("next_action_thought_id") REFERENCES "public"."thought"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_profile_user_idx" ON "project_profile" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_profile_next_action_idx" ON "project_profile" USING btree ("next_action_thought_id");
