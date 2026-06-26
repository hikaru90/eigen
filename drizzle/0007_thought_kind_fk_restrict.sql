ALTER TABLE "thought" DROP CONSTRAINT "thought_ontology_entity_kind_id_ontology_entity_kind_id_fk";
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_ontology_entity_kind_id_ontology_entity_kind_id_fk') THEN
    ALTER TABLE "thought" ADD CONSTRAINT "thought_ontology_entity_kind_id_ontology_entity_kind_id_fk" FOREIGN KEY ("ontology_entity_kind_id") REFERENCES "public"."ontology_entity_kind"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;