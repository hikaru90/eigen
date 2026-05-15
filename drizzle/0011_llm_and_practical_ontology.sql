CREATE TABLE "llm_active_provider" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'eurouter' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_provider_config" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"rule_chat" text,
	"rule_embedding" text,
	"model_chat" text,
	"model_embedding" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_provider_config_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
DROP INDEX "ontology_entity_kind_user_key_uidx";--> statement-breakpoint
ALTER TABLE "ontology_entity_kind" ADD COLUMN "kind_type" text DEFAULT 'thought_category' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_active_provider" ADD CONSTRAINT "llm_active_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_provider_config" ADD CONSTRAINT "llm_provider_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ontology_entity_kind_kind_type_idx" ON "ontology_entity_kind" USING btree ("user_id","kind_type");--> statement-breakpoint
ALTER TABLE "ontology_entity_kind" ADD CONSTRAINT "ontology_entity_kind_user_key_uidx" UNIQUE("user_id","key");