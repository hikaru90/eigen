ALTER TABLE "eval_qa" ADD COLUMN IF NOT EXISTS "retrieval_query" text;
--> statement-breakpoint
ALTER TABLE "eval_qa" ADD COLUMN IF NOT EXISTS "retrieval_relevant_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "eval_qa" ADD COLUMN IF NOT EXISTS "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "eval_qa" ADD COLUMN IF NOT EXISTS "edit_json" jsonb;
--> statement-breakpoint
INSERT INTO "eval_qa" ("id", "question", "acceptance", "captures_json", "retrieval_query", "retrieval_relevant_json", "tags_json", "edit_json") VALUES
(
	'qa_synthesis_priya_books',
	'which books has Priya pointed me to',
	'Must mention Antifragile, Skin in the Game, Naval''s Almanack (or Almanack of Naval), and Seneca. May mention Thinking Fast and Slow if grounded in captures.',
	'[
		{"fixtureId": "ec_067", "rawText": "Priya''s reading list: Antifragile, Skin in the Game, Naval''s Almanack, Seneca."},
		{"fixtureId": "ec_065", "rawText": "Started Thinking Fast and Slow by Kahneman. Priya recommended it years ago."},
		{"fixtureId": "ec_069", "rawText": "Priya said the Almanack of Naval is best read in small pieces over months, not binged."}
	]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["synthesis"]'::jsonb,
	NULL
),
(
	'qa_contradiction_remote_work',
	'how do I feel about remote work',
	'Must surface both conflicting views (remote work is bad for discipline vs working from home is great/productive). Should note the contradiction or present both with appropriate uncertainty.',
	'[
		{"fixtureId": "ec_101", "rawText": "Remote work is terrible for me. I lose all discipline and end up doing nothing. Need an office."},
		{"fixtureId": "ec_102", "rawText": "Working from home is actually great. I''m more productive, calmer, and the commute savings are real."}
	]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["contradiction"]'::jsonb,
	NULL
),
(
	'qa_staleness_where_live',
	'where do I live now',
	'Must prefer the more recent location (Berlin, moved from London last month) over the older London/Hackney plan.',
	'[
		{"fixtureId": "ec_114", "rawText": "Moved to London. Found a flat in Hackney, taking over in September."},
		{"fixtureId": "ec_113", "rawText": "I live in Berlin now. Just moved here from London last month."}
	]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["temporal"]'::jsonb,
	NULL
),
(
	'qa_haystack_walnut',
	'what is Marcus allergic to',
	'Must state walnut allergy. Must not invent other allergies.',
	'[
		{"fixtureId": "ec_001", "rawText": "Started a new sourdough starter today, 50/50 rye and bread flour, 100% hydration."},
		{"fixtureId": "ec_002", "rawText": "Marcus said his starter doubles in 4 hours at room temp. Mine takes 6. Probably my apartment is cooler."},
		{"fixtureId": "ec_003", "rawText": "Tried Tartine''s country loaf recipe. The autolyse step makes a real difference."},
		{"fixtureId": "ec_004", "rawText": "Had brunch at Tartine with Marcus. We split the morning bun and the country loaf."},
		{"fixtureId": "ec_005", "rawText": "Idea: cold ferment overnight in the fridge to deepen flavor without extra labor."},
		{"fixtureId": "ec_006", "rawText": "Marcus suggested using a banneton with rice flour to prevent sticking. Worth trying."},
		{"fixtureId": "ec_007", "rawText": "Bought a new lame for scoring loaves. The curved blade gives prettier ears."},
		{"fixtureId": "ec_008", "rawText": "The crumb on yesterday''s loaf was tighter than I wanted. Probably under-fermented."},
		{"fixtureId": "ec_009", "rawText": "Need to buy more bread flour and a kitchen scale that goes to 0.1g resolution."},
		{"fixtureId": "ec_010", "rawText": "Made focaccia for the first time. Surprisingly forgiving compared to sourdough."},
		{"fixtureId": "ec_011", "rawText": "Marcus is allergic to walnuts. Don''t bring the walnut levain to next dinner."}
	]'::jsonb,
	'Marcus walnut allergy dinner',
	'[{"id": "ec_011", "grade": 3}]'::jsonb,
	'["haystack", "recall"]'::jsonb,
	NULL
),
(
	'qa_edit_allergy_update',
	'what is Marcus allergic to now',
	'Must state pecan allergy (updated). Must not still claim walnut as the current allergy unless noting the correction.',
	'[
		{"fixtureId": "ec_011", "rawText": "Marcus is allergic to walnuts. Don''t bring the walnut levain to next dinner."}
	]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["edit"]'::jsonb,
	'{"fixtureId": "ec_011", "newRawText": "Correction: Marcus is allergic to pecans, not walnuts. Do not bring pecan bread to dinner."}'::jsonb
)
ON CONFLICT ("id") DO NOTHING;
