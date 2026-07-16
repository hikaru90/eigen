ALTER TABLE "connected_agent" ADD COLUMN IF NOT EXISTS "signature_mode" text DEFAULT 'generic' NOT NULL;
