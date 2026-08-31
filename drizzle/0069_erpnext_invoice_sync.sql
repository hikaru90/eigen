ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "erpnext_invoice_name" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN IF NOT EXISTS "erpnext_synced_at" timestamp;
