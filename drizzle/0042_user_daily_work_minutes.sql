ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "daily_work_minutes" integer NOT NULL DEFAULT 480;
