CREATE TABLE IF NOT EXISTS "eval_scenario" (
	"id" text PRIMARY KEY NOT NULL,
	"goal" text NOT NULL,
	"captures_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entries_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "eval_scenario" ("id", "goal", "captures_json", "entries_json") VALUES
(
	'smoke',
	'Quick smoke — ingest two thoughts, one retrieval probe, one answer.',
	'[
		{"fixtureId": "ec_011", "rawText": "Marcus is allergic to walnuts. Do not bring walnut bread to dinner."},
		{"fixtureId": "ec_006", "rawText": "Marcus suggested using a banneton with rice flour to prevent sticking."}
	]'::jsonb,
	'[
		{"kind": "retrieval", "fixtureQueryId": "q_rel_001"},
		{
			"kind": "answer",
			"question": "what should I avoid bringing to dinner with Marcus",
			"acceptance": "Must mention walnut allergy for Marcus. Must not invent other allergies."
		}
	]'::jsonb
),
(
	'marcus_allergy_recall',
	'Verify allergy note is retrievable and cited in answers.',
	'[
		{
			"fixtureId": "ec_011",
			"rawText": "Marcus is allergic to walnuts. Don''t bring the walnut levain to next dinner."
		}
	]'::jsonb,
	'[
		{"kind": "retrieval", "fixtureQueryId": "q_rel_001"},
		{
			"kind": "answer",
			"question": "what food should I avoid for Marcus at dinner",
			"acceptance": "Must state walnut allergy; must not invent other allergies."
		}
	]'::jsonb
)
ON CONFLICT ("id") DO NOTHING;
