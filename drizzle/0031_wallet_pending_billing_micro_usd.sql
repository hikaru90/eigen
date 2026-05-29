ALTER TABLE "user_wallet" ADD COLUMN IF NOT EXISTS "pending_billing_micro_usd" integer DEFAULT 0 NOT NULL;
