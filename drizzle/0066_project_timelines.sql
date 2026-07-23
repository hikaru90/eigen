ALTER TABLE "canonical_entity" ADD COLUMN IF NOT EXISTS "target_date" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_task_sequence" (
	"project_entity_id" uuid NOT NULL,
	"thought_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_task_sequence_pk" PRIMARY KEY("project_entity_id","thought_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_task_sequence_user_project_thought_uidx"
	ON "project_task_sequence" USING btree ("user_id","project_entity_id","thought_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_task_sequence_user_project_rank_uidx"
	ON "project_task_sequence" USING btree ("user_id","project_entity_id","rank");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_sequence_user_idx"
	ON "project_task_sequence" USING btree ("user_id");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_task_sequence_project_entity_id_canonical_entity_id_fk'
	) THEN
		ALTER TABLE "project_task_sequence"
			ADD CONSTRAINT "project_task_sequence_project_entity_id_canonical_entity_id_fk"
			FOREIGN KEY ("project_entity_id") REFERENCES "public"."canonical_entity"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_task_sequence_thought_id_thought_id_fk'
	) THEN
		ALTER TABLE "project_task_sequence"
			ADD CONSTRAINT "project_task_sequence_thought_id_thought_id_fk"
			FOREIGN KEY ("thought_id") REFERENCES "public"."thought"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_task_sequence_user_id_user_id_fk'
	) THEN
		ALTER TABLE "project_task_sequence"
			ADD CONSTRAINT "project_task_sequence_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"target_date" timestamp with time zone,
	"rank" integer NOT NULL DEFAULT 1,
	"completed_at" timestamp with time zone,
	"linked_thought_id" uuid,
	"linked_temporal_event_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestone_user_idx"
	ON "project_milestone" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestone_project_idx"
	ON "project_milestone" USING btree ("user_id","project_entity_id");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_milestone_project_entity_id_canonical_entity_id_fk'
	) THEN
		ALTER TABLE "project_milestone"
			ADD CONSTRAINT "project_milestone_project_entity_id_canonical_entity_id_fk"
			FOREIGN KEY ("project_entity_id") REFERENCES "public"."canonical_entity"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_milestone_user_id_user_id_fk'
	) THEN
		ALTER TABLE "project_milestone"
			ADD CONSTRAINT "project_milestone_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_milestone_linked_thought_id_thought_id_fk'
	) THEN
		ALTER TABLE "project_milestone"
			ADD CONSTRAINT "project_milestone_linked_thought_id_thought_id_fk"
			FOREIGN KEY ("linked_thought_id") REFERENCES "public"."thought"("id") ON DELETE set null ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_milestone_linked_temporal_event_id_temporal_event_id_fk'
	) THEN
		ALTER TABLE "project_milestone"
			ADD CONSTRAINT "project_milestone_linked_temporal_event_id_temporal_event_id_fk"
			FOREIGN KEY ("linked_temporal_event_id") REFERENCES "public"."temporal_event"("id") ON DELETE set null ON UPDATE no action;
	END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
