CREATE TABLE "task" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"base_cost_usd" text NOT NULL,
	"markup_usd" text NOT NULL,
	"total_cost_usd" text NOT NULL,
	"markup_rate" text DEFAULT '0.20' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"raw_input" text NOT NULL,
	"normalized_preview" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'thought' NOT NULL,
	"metadata_preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thought" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"lexical_text" text DEFAULT '' NOT NULL,
	"lexical_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(lexical_text, ''))) STORED NOT NULL,
	"category" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thought_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_thought_id" uuid NOT NULL,
	"target_thought_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"preferred_transcription_quality" text DEFAULT 'low' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_call_log" ADD CONSTRAINT "activity_call_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_session" ADD CONSTRAINT "capture_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thought" ADD CONSTRAINT "thought_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thought_relation" ADD CONSTRAINT "thought_relation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thought_relation" ADD CONSTRAINT "thought_relation_source_thought_id_thought_id_fk" FOREIGN KEY ("source_thought_id") REFERENCES "public"."thought"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thought_relation" ADD CONSTRAINT "thought_relation_target_thought_id_thought_id_fk" FOREIGN KEY ("target_thought_id") REFERENCES "public"."thought"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "activity_call_log_user_idx" ON "activity_call_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "capture_session_user_idx" ON "capture_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "capture_session_status_idx" ON "capture_session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "thought_user_idx" ON "thought" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "thought_lexical_tsv_idx" ON "thought" USING gin ("lexical_tsv");--> statement-breakpoint
CREATE INDEX "thought_embedding_hnsw_idx" ON "thought" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "thought_relation_user_idx" ON "thought_relation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "thought_relation_source_idx" ON "thought_relation" USING btree ("source_thought_id");--> statement-breakpoint
CREATE INDEX "thought_relation_target_idx" ON "thought_relation" USING btree ("target_thought_id");--> statement-breakpoint
CREATE INDEX "user_preference_language_idx" ON "user_preference" USING btree ("preferred_language");--> statement-breakpoint
CREATE INDEX "user_preference_quality_idx" ON "user_preference" USING btree ("preferred_transcription_quality");