ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "account_kind" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_account_kind_check') THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_account_kind_check" CHECK ("account_kind" IN ('production', 'harness'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
UPDATE "user"
SET "account_kind" = 'harness'
WHERE lower(split_part("email", '@', 2)) IN ('local.eval', 'test.eigen');
