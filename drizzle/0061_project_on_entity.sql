ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "project_status" text;
--> statement-breakpoint
ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "project_source" text;
--> statement-breakpoint
ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "next_action_thought_id" uuid;
--> statement-breakpoint
ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "project_designated_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canonical_entity_next_action_thought_id_thought_id_fk') THEN
    ALTER TABLE "canonical_entity" ADD CONSTRAINT "canonical_entity_next_action_thought_id_thought_id_fk" FOREIGN KEY ("next_action_thought_id") REFERENCES "public"."thought"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
UPDATE "canonical_entity" ce
SET
  "project_status" = pp."status",
  "project_source" = pp."source",
  "next_action_thought_id" = pp."next_action_thought_id",
  "project_designated_at" = pp."designated_at"
FROM "project_profile" pp
WHERE ce."id" = pp."project_entity_id" AND ce."user_id" = pp."user_id";
--> statement-breakpoint
ALTER TABLE "thought_entity" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'ingest' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_entity_user_project_idx" ON "canonical_entity" USING btree ("user_id") WHERE "project_status" IS NOT NULL;
--> statement-breakpoint
DROP TABLE IF EXISTS "project_profile";
