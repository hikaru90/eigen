ALTER TABLE "user_preference" ADD COLUMN "daily_summary_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "daily_summary_minutes_local" integer DEFAULT 480 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "last_daily_summary_local_date" text;
