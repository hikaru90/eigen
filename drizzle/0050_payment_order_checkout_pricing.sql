ALTER TABLE "payment_order" ADD COLUMN "charged_gross_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN "platform_subtotal_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN "estimated_paypal_fee_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN "actual_paypal_fee_usd" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN "net_received_usd" text;
