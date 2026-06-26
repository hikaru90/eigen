ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "charged_gross_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "platform_subtotal_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "estimated_paypal_fee_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "actual_paypal_fee_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "net_received_usd" text;
