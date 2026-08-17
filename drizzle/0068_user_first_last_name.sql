-- Given/family name captured at signup (manual form or OAuth profile), synced to Owlery contacts.
-- Nullable: existing users and harness-created users have no name parts.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "first_name" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_name" text;
