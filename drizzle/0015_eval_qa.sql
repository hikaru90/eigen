CREATE TABLE IF NOT EXISTS "eval_qa" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"acceptance" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "eval_qa" ("id", "question", "acceptance") VALUES
(
	'qa_smoke_dinner',
	'what should I avoid bringing to dinner with Marcus',
	'Must mention walnut allergy for Marcus. Must not invent other allergies.'
),
(
	'qa_marcus_dinner',
	'what food should I avoid for Marcus at dinner',
	'Must state walnut allergy; must not invent other allergies.'
)
ON CONFLICT ("id") DO NOTHING;
