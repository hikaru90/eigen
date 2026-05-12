CREATE TABLE "user_api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_api_key" ADD CONSTRAINT "user_api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_api_key_user_idx" ON "user_api_key" USING btree ("user_id");