ALTER TABLE "eval_qa" ADD COLUMN IF NOT EXISTS "captures_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "eval_qa" SET "captures_json" = '[
	{"fixtureId": "ec_011", "rawText": "Marcus is allergic to walnuts. Do not bring walnut bread to dinner."},
	{"fixtureId": "ec_006", "rawText": "Marcus suggested using a banneton with rice flour to prevent sticking."}
]'::jsonb
WHERE "id" = 'qa_smoke_dinner';
--> statement-breakpoint
UPDATE "eval_qa" SET "captures_json" = '[
	{"fixtureId": "ec_011", "rawText": "Marcus is allergic to walnuts. Don''t bring the walnut levain to next dinner."}
]'::jsonb
WHERE "id" = 'qa_marcus_dinner';
