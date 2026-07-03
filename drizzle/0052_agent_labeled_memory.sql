-- Agent-labeled memory: author dimension keyed by named user_api_key

ALTER TABLE "capture_session" ADD COLUMN IF NOT EXISTS "author" text DEFAULT 'user' NOT NULL;
ALTER TABLE "capture_session" ADD COLUMN IF NOT EXISTS "author_label" text;
ALTER TABLE "capture_session" ADD COLUMN IF NOT EXISTS "author_key_id" uuid;

ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "author" text DEFAULT 'user' NOT NULL;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "author_label" text;
ALTER TABLE "thought" ADD COLUMN IF NOT EXISTS "author_key_id" uuid;

ALTER TABLE "text_file" ADD COLUMN IF NOT EXISTS "author" text DEFAULT 'user' NOT NULL;
ALTER TABLE "text_file" ADD COLUMN IF NOT EXISTS "author_label" text;
ALTER TABLE "text_file" ADD COLUMN IF NOT EXISTS "author_key_id" uuid;

ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "author" text DEFAULT 'user' NOT NULL;
ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "author_label" text;
ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "author_key_id" uuid;

ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "author" text DEFAULT 'user' NOT NULL;
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "author_label" text;
ALTER TABLE "temporal_event" ADD COLUMN IF NOT EXISTS "author_key_id" uuid;

CREATE INDEX IF NOT EXISTS "capture_session_author_idx" ON "capture_session" ("user_id", "author");
CREATE INDEX IF NOT EXISTS "thought_author_idx" ON "thought" ("user_id", "author");
CREATE INDEX IF NOT EXISTS "thought_author_key_idx" ON "thought" ("author_key_id");
CREATE INDEX IF NOT EXISTS "text_file_author_idx" ON "text_file" ("user_id", "author");
CREATE INDEX IF NOT EXISTS "canonical_entity_author_idx" ON "canonical_entity" ("user_id", "author");
CREATE INDEX IF NOT EXISTS "temporal_event_author_idx" ON "temporal_event" ("user_id", "author");

ALTER TABLE "thought"
	ADD CONSTRAINT "thought_author_key_id_user_api_key_fk"
	FOREIGN KEY ("author_key_id") REFERENCES "user_api_key"("id") ON DELETE SET NULL;

ALTER TABLE "capture_session"
	ADD CONSTRAINT "capture_session_author_key_id_user_api_key_fk"
	FOREIGN KEY ("author_key_id") REFERENCES "user_api_key"("id") ON DELETE SET NULL;

ALTER TABLE "text_file"
	ADD CONSTRAINT "text_file_author_key_id_user_api_key_fk"
	FOREIGN KEY ("author_key_id") REFERENCES "user_api_key"("id") ON DELETE SET NULL;

ALTER TABLE "canonical_entity"
	ADD CONSTRAINT "canonical_entity_author_key_id_user_api_key_fk"
	FOREIGN KEY ("author_key_id") REFERENCES "user_api_key"("id") ON DELETE SET NULL;

ALTER TABLE "temporal_event"
	ADD CONSTRAINT "temporal_event_author_key_id_user_api_key_fk"
	FOREIGN KEY ("author_key_id") REFERENCES "user_api_key"("id") ON DELETE SET NULL;
