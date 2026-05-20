-- Synthetic operative-pearl evals (fictional teaching vignettes, not patient identifiers).
-- Tests recall of tightly coupled numeric / device / landmark details a surgeon might log between cases.

--> statement-breakpoint

INSERT INTO "eval_qa" ("id", "question", "acceptance", "captures_json", "retrieval_query", "retrieval_relevant_json", "tags_json", "edit_json", "checks_json") VALUES
(
	'qa_surgical_vats_phrenic_stapler',
	'In my VATS upper-lobe wedge note for the part-solid nodule, how many millimeters did I stay medial to the phrenic nerve at the upper pole, and which Endo GIA thoracic stapler load color matches the closed staple height I wrote down?',
	'Must state 11 mm (or eleven millimeters) medial to the phrenic and identify the green thoracic load (or explicitly 4.8 mm closed staple height). Must not substitute a different distance or staple color.',
	'[{"fixtureId":"ec_surg_vats","rawText":"RATS upper-lobe wedge for 1.1 cm part-solid nodule: 30-degree scope, stayed 11 mm medial to the right phrenic at the upper pole during hilar dissection. Ice-saline slurry on the raw parenchyma strip unchanged at 90 seconds — still proceeded with wedge but had VATS tray ready if blanching appeared. Fired Endo GIA tri-staple thoracic green load with recorded closed staple height 4.8 mm over compressed parenchyma; thin VATS weave buttress. No air leak at 30 cmH2O underwater."}]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["surgical_memory","recall_detail"]'::jsonb,
	NULL,
	'{"graph":{"requireThoughtNodes":["ec_surg_vats"]},"entities":[{"fixtureId":"ec_surg_vats","minCount":1,"surfacesContaining":["phrenic","green"]}],"ontology":{"requireActiveCategories":["ec_surg_vats"]},"extraction":{"requireEnriched":["ec_surg_vats"]},"embedding":{"requireVector":["ec_surg_vats"],"minLexicalLength":3}}'::jsonb
),
(
	'qa_surgical_redo_aorto_ptfe_strip',
	'For the redo aorto-bifemoral exposure I logged, which rib interspace did I use for the left flank extraperitoneal corridor, and what width PTFE strip did I wrap the proximal anastomosis with?',
	'Must identify the corridor between the eleventh and twelfth ribs (or 11th–12th intercostal interspace) and state a 6 mm PTFE strip (six millimeter). Must not invent a different interspace or strip width.',
	'[{"fixtureId":"ec_surg_aorto","rawText":"Redo aorto-bifemoral for threatened limb perfusion with graft infection: left flank extraperitoneal tunnel between 11th and 12th ribs, retrorenal plane to the aorta. Infrarenal clamp after shaving a sharp posterior calcific ridge on the neck. Proximal anastomosis buttressed with a 6 mm woven PTFE pledget strip in interrupted fashion; three laparotomy gelpacks kept the field dry before sequential unclamping."}]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["surgical_memory","recall_detail"]'::jsonb,
	NULL,
	'{"graph":{"requireThoughtNodes":["ec_surg_aorto"]},"entities":[{"fixtureId":"ec_surg_aorto","minCount":1,"surfacesContaining":["12th","PTFE"]}],"ontology":{"requireActiveCategories":["ec_surg_aorto"]},"extraction":{"requireEnriched":["ec_surg_aorto"]},"embedding":{"requireVector":["ec_surg_aorto"],"minLexicalLength":3}}'::jsonb
),
(
	'qa_surgical_neonate_duodenum_diamond',
	'Before the diamond duodeno-duodenostomy I noted for the neonatal atresia, what proximal and distal luminal diameters in centimeters did I record, and what suture plus approximate posterior-row bite spacing did I use?',
	'Must give proximal 1.2 cm and distal 0.4 cm (order may vary but both values required). Must name PDS 6-0 (or polydioxanone 6-0) and approximately 0.8 mm between interrupted posterior bites. Must not swap the two diameters or invent other sutures.',
	'[{"fixtureId":"ec_surg_neonate","rawText":"Referred type III duodenal atresia with apple-peel pattern: proximal duodenal lumen about 1.2 cm, distal pouch 0.4 cm caliber. Diamond duodeno-duodenostomy — posterior row PDS 6-0 full-thickness interrupted bites roughly every 0.8 mm; anterior row deferred for Lembert seromuscular after saline syringe patency check."}]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["surgical_memory","recall_detail"]'::jsonb,
	NULL,
	'{"graph":{"requireThoughtNodes":["ec_surg_neonate"]},"entities":[{"fixtureId":"ec_surg_neonate","minCount":1,"surfacesContaining":["diamond","PDS"]}],"ontology":{"requireActiveCategories":["ec_surg_neonate"]},"extraction":{"requireEnriched":["ec_surg_neonate"]},"embedding":{"requireVector":["ec_surg_neonate"],"minLexicalLength":3}}'::jsonb
),
(
	'qa_surgical_mis_tlif_navigation_tap',
	'For the MIS TLIF with Stealth navigation, which paired bony landmarks did I register on, what RMS error did I accept versus the institutional cutoff before drilling, and how far short of the anterior cortex did I stop the tap?',
	'Must name both L4 transverse processes as the registration pair (or equivalent wording). Must state RMS 1.6 mm accepted against a 2.0 mm cutoff (both numbers). Must state the tap stopped 10 mm shy of the anterior cortex (ten millimeters). Must not invent other landmarks or thresholds.',
	'[{"fixtureId":"ec_surg_tlif","rawText":"MIS TLIF L4-L5 after intraoperative AP fluoroscopy degraded. StealthArray navigation: registration anchored on paired L4 transverse processes with RMS error 1.6 mm versus institutional proceed-if-under 2.0 mm, so I continued. Navigated pedicle pilot; tap advanced until intentionally 10 mm short of anterior vertebral cortex when tactile feedback changed — no breach."}]'::jsonb,
	NULL,
	'[]'::jsonb,
	'["surgical_memory","recall_detail"]'::jsonb,
	NULL,
	'{"graph":{"requireThoughtNodes":["ec_surg_tlif"]},"entities":[{"fixtureId":"ec_surg_tlif","minCount":1,"surfacesContaining":["transverse","tlif"]}],"ontology":{"requireActiveCategories":["ec_surg_tlif"]},"extraction":{"requireEnriched":["ec_surg_tlif"]},"embedding":{"requireVector":["ec_surg_tlif"],"minLexicalLength":3}}'::jsonb
)
ON CONFLICT ("id") DO NOTHING;
