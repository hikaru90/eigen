ALTER TABLE "user_preference" ADD COLUMN "preferred_ui_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE INDEX "user_preference_ui_locale_idx" ON "user_preference" USING btree ("preferred_ui_locale");
