-- Eigen platform credits: 1000 credits per USD (migrate from USD cents * 10).

ALTER TABLE "user_wallet" RENAME COLUMN "available_cents" TO "available_credits";
ALTER TABLE "user_wallet" RENAME COLUMN "reserved_cents" TO "reserved_credits";
UPDATE "user_wallet" SET "available_credits" = "available_credits" * 10;
UPDATE "user_wallet" SET "reserved_credits" = "reserved_credits" * 10;
UPDATE "user_wallet" SET "currency" = 'USD';

ALTER TABLE "wallet_ledger_entry" RENAME COLUMN "amount_cents" TO "amount_credits";
UPDATE "wallet_ledger_entry" SET "amount_credits" = "amount_credits" * 10;

ALTER TABLE "payment_order" RENAME COLUMN "requested_cents" TO "requested_credits";
ALTER TABLE "payment_order" RENAME COLUMN "captured_cents" TO "captured_credits";
UPDATE "payment_order" SET "requested_credits" = "requested_credits" * 10;
UPDATE "payment_order" SET "captured_credits" = "captured_credits" * 10 WHERE "captured_credits" IS NOT NULL;
