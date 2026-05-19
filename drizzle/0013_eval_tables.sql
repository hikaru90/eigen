CREATE TABLE "eval_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"eval_user_id" text NOT NULL,
	"label" text NOT NULL,
	"scenario_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synthesis_json" jsonb,
	"started_at" timestamp,
	"finished_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"fixture_ref" text,
	"input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expected_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"passed" boolean,
	"result_json" jsonb,
	"error" text,
	"duration_ms" integer,
	"depends_on_entry_id" uuid,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "eval_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entry_id" uuid,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_thought_map" (
	"run_id" uuid NOT NULL,
	"fixture_id" text NOT NULL,
	"thought_id" uuid NOT NULL,
	CONSTRAINT "eval_thought_map_run_id_fixture_id_pk" PRIMARY KEY("run_id","fixture_id")
);
--> statement-breakpoint
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eval_entry" ADD CONSTRAINT "eval_entry_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eval_event" ADD CONSTRAINT "eval_event_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eval_event" ADD CONSTRAINT "eval_event_entry_id_eval_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."eval_entry"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eval_thought_map" ADD CONSTRAINT "eval_thought_map_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "eval_run_user_idx" ON "eval_run" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "eval_run_user_created_idx" ON "eval_run" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "eval_entry_run_idx" ON "eval_entry" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "eval_entry_run_ordinal_idx" ON "eval_entry" USING btree ("run_id","ordinal");
--> statement-breakpoint
CREATE INDEX "eval_event_run_idx" ON "eval_event" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "eval_event_run_created_idx" ON "eval_event" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE INDEX "eval_thought_map_run_idx" ON "eval_thought_map" USING btree ("run_id");
