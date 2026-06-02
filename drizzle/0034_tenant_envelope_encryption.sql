CREATE TABLE IF NOT EXISTS "tenant_data_key" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"wrapped_dek" text NOT NULL,
	"dek_version" integer NOT NULL DEFAULT 1,
	"kek_provider" text NOT NULL,
	"kek_key_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "raw_text_encrypted" text;--> statement-breakpoint
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "normalized_text_encrypted" text;--> statement-breakpoint
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "metadata_encrypted" text;--> statement-breakpoint
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "cues_encrypted" text;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN IF NOT EXISTS "raw_input_encrypted" text;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN IF NOT EXISTS "normalized_preview_encrypted" text;--> statement-breakpoint
ALTER TABLE "llm_provider_config" ADD COLUMN IF NOT EXISTS "api_key_encrypted" text;
