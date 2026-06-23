CREATE TABLE IF NOT EXISTS "connected_agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"webhook_url" text NOT NULL,
	"subscribed_events" text[] DEFAULT '{}' NOT NULL,
	"signing_secret_encrypted" text NOT NULL,
	"signing_secret_prefix" text NOT NULL,
	"callback_token_hash" text NOT NULL,
	"callback_token_prefix" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_delivery_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "connected_agent_user_idx" ON "connected_agent" ("user_id");

CREATE TABLE IF NOT EXISTS "agent_task_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"agent_id" uuid NOT NULL REFERENCES "connected_agent"("id") ON DELETE CASCADE,
	"thought_id" uuid NOT NULL REFERENCES "thought"("id") ON DELETE CASCADE,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"result_summary" text,
	"result_thought_id" uuid REFERENCES "thought"("id") ON DELETE SET NULL,
	"last_error" text
);

CREATE INDEX IF NOT EXISTS "agent_task_assignment_user_idx" ON "agent_task_assignment" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_task_assignment_agent_idx" ON "agent_task_assignment" ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_task_assignment_thought_idx" ON "agent_task_assignment" ("thought_id");

CREATE TABLE IF NOT EXISTS "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"agent_id" uuid NOT NULL REFERENCES "connected_agent"("id") ON DELETE CASCADE,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"http_status" integer,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhook_delivery_user_idx" ON "webhook_delivery" ("user_id");
CREATE INDEX IF NOT EXISTS "webhook_delivery_agent_idx" ON "webhook_delivery" ("agent_id");
CREATE INDEX IF NOT EXISTS "webhook_delivery_status_idx" ON "webhook_delivery" ("status", "created_at");
