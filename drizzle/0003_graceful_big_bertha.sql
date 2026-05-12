CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_session_id_chat_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_session_idx" ON "chat_message" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chat_message_user_idx" ON "chat_message" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_message_created_idx" ON "chat_message" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_session_user_idx" ON "chat_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_session_updated_idx" ON "chat_session" USING btree ("user_id","updated_at");