-- Drop the intermediate columns added in the previous (unapplied) migration attempt.
-- Uses IF EXISTS on both the table and column so this is a no-op when llm_config
-- was never created (e.g. on a fresh install or a DB bootstrapped without it).
ALTER TABLE IF EXISTS "llm_config" DROP COLUMN IF EXISTS "llm_provider";
ALTER TABLE IF EXISTS "llm_config" DROP COLUMN IF EXISTS "llm_model_chat";
ALTER TABLE IF EXISTS "llm_config" DROP COLUMN IF EXISTS "llm_model_embedding";

-- New table: one row per (user, provider) — each provider has its own credentials.
CREATE TABLE IF NOT EXISTS "llm_provider_config" (
  "user_id"          text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "provider"         text        NOT NULL,
  "base_url"         text        NOT NULL,
  "api_key"          text        NOT NULL,
  "rule_chat"        text,
  "rule_embedding"   text,
  "model_chat"       text,
  "model_embedding"  text,
  "updated_at"       timestamp   NOT NULL DEFAULT now(),
  CONSTRAINT "llm_provider_config_pk" PRIMARY KEY ("user_id", "provider")
);

-- New table: tracks which provider is currently active for a user.
CREATE TABLE IF NOT EXISTS "llm_active_provider" (
  "user_id"     text      PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "provider"    text      NOT NULL DEFAULT 'eurouter',
  "updated_at"  timestamp NOT NULL DEFAULT now()
);

-- Migrate existing llm_config rows into the new tables (EUrouter credentials).
-- Wrapped in a DO block so this is a no-op when llm_config never existed.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'llm_config'
	) THEN
		INSERT INTO "llm_provider_config" ("user_id", "provider", "base_url", "api_key", "rule_chat", "rule_embedding", "updated_at")
		SELECT "user_id", 'eurouter', "llm_base_url", "llm_api_key", "llm_rule_chat", "llm_rule_embedding", "updated_at"
		FROM "llm_config"
		ON CONFLICT ("user_id", "provider") DO NOTHING;

		INSERT INTO "llm_active_provider" ("user_id", "provider", "updated_at")
		SELECT "user_id", 'eurouter', "updated_at"
		FROM "llm_config"
		ON CONFLICT ("user_id") DO NOTHING;
	END IF;
END $$;

-- Drop old table.
DROP TABLE IF EXISTS "llm_config";
