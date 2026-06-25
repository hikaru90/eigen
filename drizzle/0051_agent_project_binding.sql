CREATE TABLE IF NOT EXISTS "agent_project_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"agent_id" uuid NOT NULL REFERENCES "connected_agent"("id") ON DELETE CASCADE,
	"project_entity_id" uuid NOT NULL REFERENCES "canonical_entity"("id") ON DELETE CASCADE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_project_binding_uniq" UNIQUE ("agent_id", "project_entity_id")
);

CREATE INDEX IF NOT EXISTS "agent_project_binding_user_idx" ON "agent_project_binding" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_project_binding_agent_idx" ON "agent_project_binding" ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_project_binding_project_idx" ON "agent_project_binding" ("project_entity_id");
