ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "preferred_ui_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_preference_ui_locale_idx" ON "user_preference" USING btree ("preferred_ui_locale");
