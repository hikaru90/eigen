DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_session_user_category_ontology_fk') THEN
    ALTER TABLE "capture_session" ADD CONSTRAINT "capture_session_user_category_ontology_fk" FOREIGN KEY ("user_id","category") REFERENCES "public"."ontology_entity_kind"("user_id","key") ON DELETE restrict ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_user_category_ontology_fk') THEN
    ALTER TABLE "thought" ADD CONSTRAINT "thought_user_category_ontology_fk" FOREIGN KEY ("user_id","category") REFERENCES "public"."ontology_entity_kind"("user_id","key") ON DELETE restrict ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;