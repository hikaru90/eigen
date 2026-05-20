-- Entity check needles must match LLM mention surfaces (entity_resolution_log.mention_surface),
-- not arbitrary numeric spans in the thought body — "1.6" is often absent from extracted surfaces.

UPDATE "eval_qa"
SET "checks_json" = '{"graph":{"requireThoughtNodes":["ec_surg_tlif"]},"entities":[{"fixtureId":"ec_surg_tlif","minCount":1,"surfacesContaining":["transverse","tlif"]}],"ontology":{"requireActiveCategories":["ec_surg_tlif"]},"extraction":{"requireEnriched":["ec_surg_tlif"]},"embedding":{"requireVector":["ec_surg_tlif"],"minLexicalLength":3}}'::jsonb
WHERE "id" = 'qa_surgical_mis_tlif_navigation_tap';
