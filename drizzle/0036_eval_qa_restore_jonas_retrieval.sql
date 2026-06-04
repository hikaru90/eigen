--> statement-breakpoint
-- Restore retrieval grading for qa_jonas_creative_silence if an earlier auto-prune cleared it (needle-only QA).
UPDATE "eval_qa"
SET
	"retrieval_query" = 'Jonas creative work conditions',
	"retrieval_relevant_json" = '[{"id": "ec_jonas_silence", "grade": 3}]'::jsonb,
	"checks_json" = jsonb_set(
		COALESCE("checks_json", '{}'::jsonb),
		'{retrieval}',
		'{"minNdcgAt10": 0.5, "needleFixtureId": "ec_jonas_silence", "needleTopK": 5}'::jsonb,
		true
	),
	"updated_at" = NOW()
WHERE "id" = 'qa_jonas_creative_silence'
	AND (
		"retrieval_query" IS NULL
		OR trim("retrieval_query") = ''
		OR "retrieval_relevant_json" = '[]'::jsonb
	);
