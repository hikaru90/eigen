ALTER TABLE "project_profile" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'capture' NOT NULL;
