-- Early-access agreement (open alpha). Nullable timestamp on user_preference:
-- NULL = not accepted. NEW users must accept the agreement on first app entry.
-- GRANDFATHERING: all rows existing at migration time are marked accepted via
-- UPDATE ... now() below, so only accounts created after this deploy see the modal.

ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "beta_agreement_accepted_at" timestamp with time zone;

-- Grandfather every pre-existing user: they never see the agreement modal.
UPDATE "user_preference" SET "beta_agreement_accepted_at" = now() WHERE "beta_agreement_accepted_at" IS NULL;
