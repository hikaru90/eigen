ALTER TABLE "user_preference" ADD COLUMN "billing_mode" text DEFAULT 'platform_credits' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "default_billing_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
CREATE TABLE "user_wallet" (
	"user_id" text PRIMARY KEY NOT NULL,
	"available_cents" integer DEFAULT 0 NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_wallet" ADD CONSTRAINT "user_wallet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "wallet_ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_ledger_entry" ADD CONSTRAINT "wallet_ledger_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_ledger_entry_user_idx" ON "wallet_ledger_entry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_entry_user_created_idx" ON "wallet_ledger_entry" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE "payment_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'paypal' NOT NULL,
	"paypal_order_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"requested_cents" integer NOT NULL,
	"captured_cents" integer,
	"currency" text NOT NULL,
	"payer_email" text,
	"raw_capture" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_paypal_order_id_uidx" ON "payment_order" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE INDEX "payment_order_user_idx" ON "payment_order" USING btree ("user_id");
