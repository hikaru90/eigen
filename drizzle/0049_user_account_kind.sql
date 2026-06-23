ALTER TABLE "user" ADD COLUMN "account_kind" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_account_kind_check" CHECK ("account_kind" IN ('production', 'harness'));--> statement-breakpoint
UPDATE "user"
SET "account_kind" = 'harness'
WHERE lower(split_part("email", '@', 2)) IN ('local.eval', 'test.eigen');
