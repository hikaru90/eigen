ALTER TABLE "eval_qa" ADD COLUMN IF NOT EXISTS "checks_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_011", "ec_006"]},
  "entities": [
    {"fixtureId": "ec_011", "minCount": 1, "surfacesContaining": ["Marcus", "walnut"]},
    {"fixtureId": "ec_006", "minCount": 0}
  ],
  "ontology": {"requireActiveCategories": ["ec_011", "ec_006"]},
  "extraction": {"requireEnriched": ["ec_011", "ec_006"]},
  "embedding": {"requireVector": ["ec_011", "ec_006"], "minLexicalLength": 3, "expectedDimensions": 1536}
}'::jsonb
WHERE "id" = 'qa_smoke_dinner';
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_011"]},
  "entities": [{"fixtureId": "ec_011", "minCount": 1, "surfacesContaining": ["Marcus", "walnut"]}],
  "ontology": {"requireActiveCategories": ["ec_011"]},
  "extraction": {"requireEnriched": ["ec_011"]},
  "embedding": {"requireVector": ["ec_011"], "minLexicalLength": 3}
}'::jsonb
WHERE "id" = 'qa_marcus_dinner';
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_067", "ec_065", "ec_069"]},
  "entities": [
    {"fixtureId": "ec_067", "minCount": 1, "surfacesContaining": ["Priya"]},
    {"fixtureId": "ec_065", "minCount": 1},
    {"fixtureId": "ec_069", "minCount": 0}
  ],
  "ontology": {"requireActiveCategories": ["ec_067", "ec_065", "ec_069"]},
  "extraction": {"requireEnriched": ["ec_067", "ec_065", "ec_069"]},
  "embedding": {"requireVector": ["ec_067", "ec_065", "ec_069"], "minLexicalLength": 3}
}'::jsonb
WHERE "id" = 'qa_synthesis_priya_books';
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_101", "ec_102"]},
  "relations": [{"sourceFixtureId": "ec_101", "targetFixtureId": "ec_102", "typeIncludes": "related"}],
  "entities": [
    {"fixtureId": "ec_101", "minCount": 0},
    {"fixtureId": "ec_102", "minCount": 0}
  ],
  "ontology": {"requireActiveCategories": ["ec_101", "ec_102"]},
  "extraction": {"requireEnriched": ["ec_101", "ec_102"]},
  "embedding": {"requireVector": ["ec_101", "ec_102"], "minLexicalLength": 3}
}'::jsonb
WHERE "id" = 'qa_contradiction_remote_work';
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_114", "ec_113"]},
  "entities": [{"fixtureId": "ec_113", "minCount": 1, "surfacesContaining": ["Berlin"]}],
  "ontology": {"requireActiveCategories": ["ec_114", "ec_113"]},
  "extraction": {"requireEnriched": ["ec_114", "ec_113"]},
  "embedding": {"requireVector": ["ec_114", "ec_113"], "minLexicalLength": 3}
}'::jsonb
WHERE "id" = 'qa_staleness_where_live';
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_011"]},
  "entities": [{"fixtureId": "ec_011", "minCount": 1, "surfacesContaining": ["Marcus", "walnut"]}],
  "ontology": {"requireActiveCategories": ["ec_011"]},
  "extraction": {"requireEnriched": ["ec_011"]},
  "embedding": {"requireVector": ["ec_011"], "minLexicalLength": 3},
  "retrieval": {"minNdcgAt10": 0.5, "needleFixtureId": "ec_011", "needleTopK": 5}
}'::jsonb
WHERE "id" = 'qa_haystack_walnut';
--> statement-breakpoint
UPDATE "eval_qa" SET "checks_json" = '{
  "graph": {"requireThoughtNodes": ["ec_011"]},
  "entities": [{"fixtureId": "ec_011", "minCount": 1, "surfacesContaining": ["pecan"]}],
  "ontology": {"requireActiveCategories": ["ec_011"]},
  "extraction": {"requireEnriched": ["ec_011"]},
  "embedding": {"requireVector": ["ec_011"], "minLexicalLength": 3},
  "learning": {"requireSalienceBump": false}
}'::jsonb
WHERE "id" = 'qa_edit_allergy_update';
--> statement-breakpoint
INSERT INTO "eval_qa" ("id", "question", "acceptance", "captures_json", "retrieval_query", "retrieval_relevant_json", "tags_json", "edit_json", "checks_json") VALUES
(
	'qa_ontology_growth',
	'what kinds of thoughts do I capture most often',
	'Answer should reflect dominant capture categories from the seeded thoughts (e.g. observation, idea, task mix). Profile guidance or summary should exist after enough captures.',
	'[
		{"fixtureId": "ec_g01", "rawText": "Observation: sourdough starter smells fruity today."},
		{"fixtureId": "ec_g02", "rawText": "Idea: track hydration levels per flour batch."},
		{"fixtureId": "ec_g03", "rawText": "Task: buy rice flour for banneton."},
		{"fixtureId": "ec_g04", "rawText": "Reflection: baking calms me after work."},
		{"fixtureId": "ec_g05", "rawText": "Decision: switch to overnight cold ferment."},
		{"fixtureId": "ec_g06", "rawText": "Goal: bake two loaves per week."},
		{"fixtureId": "ec_g07", "rawText": "Observation: Marcus prefers less sour bread."},
		{"fixtureId": "ec_g08", "rawText": "Idea: log oven spring with photos."},
		{"fixtureId": "ec_g09", "rawText": "Task: clean banneton tonight."},
		{"fixtureId": "ec_g10", "rawText": "Reference: Tartine book autolyse timing."},
		{"fixtureId": "ec_g11", "rawText": "Feeling: proud of last bake crumb structure."},
		{"fixtureId": "ec_g12", "rawText": "Question: does rye change fermentation speed?"}
	]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["ontology_growth"]'::jsonb,
	NULL,
	'{
		"graph": {"requireThoughtNodes": ["ec_g01","ec_g02","ec_g03","ec_g04","ec_g05","ec_g06","ec_g07","ec_g08","ec_g09","ec_g10","ec_g11","ec_g12"]},
		"ontology": {"requireActiveCategories": ["ec_g01","ec_g02","ec_g03","ec_g04","ec_g05","ec_g06","ec_g07","ec_g08","ec_g09","ec_g10","ec_g11","ec_g12"], "requireProfileGuidance": true, "minEvaluatedThoughtCount": 10},
		"extraction": {"requireEnriched": ["ec_g01","ec_g02","ec_g03","ec_g04","ec_g05","ec_g06","ec_g07","ec_g08","ec_g09","ec_g10","ec_g11","ec_g12"]},
		"embedding": {"requireVector": ["ec_g01","ec_g02","ec_g03","ec_g04","ec_g05","ec_g06","ec_g07","ec_g08","ec_g09","ec_g10","ec_g11","ec_g12"], "minLexicalLength": 3}
	}'::jsonb
)
ON CONFLICT ("id") DO NOTHING;
