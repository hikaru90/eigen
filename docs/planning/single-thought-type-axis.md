# Single thought-type axis (collapse `memoryType` into ontology `category`)

**Status:** approved direction (operator, 2026-08-10) — Option B from the ingest-type-collision analysis.
**Risk classification:** `critical` (ingestion + semantic retrieval are critical-path domains).

## Problem

A thought carried two parallel "what kind of thought is this?" labels:

- `thought.category` — per-user, evolving ontology `thought_category` kinds, FK-enforced
  (`thought_user_category_ontology_fk`).
- `thought.memoryType` — closed app enum (`episode|fact|decision|concern|preference|pattern|task`),
  TS-cast only, **no DB constraint**, classified by a second LLM call.

The vocabularies overlap (`task`, `decision` valid in both; `observation` ≈ `episode`/`fact`, …).
Two classifiers answering the same question with different answer sheets collided in production:
category keys leaked into `memoryType` (`InvalidMemoryTypeError` → fatal → `enrich_queue_status=failed`,
thought never enriched), and stale/placeholder categories in prompt context primed the category
classifier to emit out-of-set keys (`throw` → retry exhaustion → same stranded state). The codebase
carried five band-aid mechanisms for this (`memory-type-catalog.ts` confusion apparatus) plus a
dedicated-call split — all treating the symptom.

## Decision

One axis. `thought.category` is the only LLM-classified type label. `memoryType` is deleted as a
classified field and as a column. The one behavioral consumer (never-stale / salience exemption,
previously `{fact, decision, preference}`) becomes **per-kind ontology data**:
`ontology_entity_kind.never_stale`, seeded explicitly, read at usage time. Retrieval, MCP, agents,
timeline, and UI carried `memoryType` as plumbing only — all of it is removed.

## Contract (what makes invalid output impossible-to-persist)

1. The allowed category set is loaded from the DB **once, before classification**
   (`active thought_category kinds`) and passed to the classifier — never recomputed ad hoc per call site.
2. One enrich LLM call emits `{ category{key,confidence,alternatives}, cues, temporalMentions, mentions, triples }`.
3. Validation is repair-before-fail: invalid primary key → promote the model's top **valid** alternative
   (recorded in `metadata.categoryRepairedFrom`, logged); none valid → exactly **one** strict
   forced-choice retry listing only active keys; still invalid → explicit fatal error
   (unchanged failure policy, now near-unreachable).
4. Classifier prompt context (recent captures, category distribution) only ever contains **active**
   kind keys — placeholder and deactivated keys are filtered at the query level.
5. Storage backstops: `thought.category` FK (existing) + seeded `thought_category` kinds can no longer
   be deactivated (they are critical, like the `project` entity type) and are re-activated/re-inserted
   by `ensureUserOntologySeeded`. The tier-1 placeholder (`observation`) can never disappear.
6. `capture_session.category` loses its `'perception'` default (a key that does not exist in the
   practical seed — an FK landmine). Column is set explicitly on insert (already the case).

## Seeded `never_stale` values (thought_category kinds)

| Category      | never_stale | Rationale (old memoryType analogue)                 |
| ------------- | ----------- | --------------------------------------------------- |
| `decision`    | true        | was never-stale (`decision`)                        |
| `reference`   | true        | was never-stale (`fact`)                            |
| `goal`        | true        | standing intention (approx `preference` durability) |
| `reflection`  | true        | enduring self-knowledge (approx `preference`)       |
| `idea`        | true        | durable generative thought                          |
| `task`        | false       | open work — ages, needs review                      |
| `observation` | false       | time-bound notice (approx `episode`)                |
| `feeling`     | false       | ephemeral state                                     |
| `question`    | false       | open until answered                                 |
| `memory`      | false       | episodic record (old `episode` was not exempt)      |

Custom (future, user-evolved) kinds default to `never_stale = false` — conservative: perishable
until the ontology system declares durability.

## Acceptance criteria (Given/When/Then)

- **AC-1** Given an enrich bundle response whose `category.key` is not an active thought_category kind
  but `alternatives` contains a valid key, when the bundle is parsed, then the top valid alternative is
  used, the thought enriches, and `metadata.categoryRepairedFrom` records the rejected key.
- **AC-2** Given all candidate category keys are invalid, when the bundle is parsed, then exactly one
  strict forced-choice retry runs whose prompt lists only active keys; on success the thought enriches;
  on failure enrichment fails explicitly (fatal, visible in `enrich_queue_error`).
- **AC-3** Given stored thoughts whose category is a placeholder or deactivated key, when classifier
  context is built (recent captures, category distribution), then no inactive key appears in the prompt.
- **AC-4** Given any capture path (UI interpret, queued enrich, edit re-classify), when classification
  completes, then `thought.category` is always an active thought_category kind key — there is no code
  path that can persist or strand an invalid category.
- **AC-5** Given the ontology seed, when kinds are loaded, then `decision|reference|goal|reflection|idea`
  have `never_stale = true` and seeded thought_category kinds cannot be deactivated and are re-activated
  by `ensureUserOntologySeeded`.
- **AC-6** Given a thought whose category's kind has `never_stale = true`, when Q&A staleness or
  salience recompute runs, then the thought is exempt — with no `memoryType` field anywhere in the path.
- **AC-7** Given the enrich pipeline, when a thought is enriched, then exactly one LLM call produces
  category + cues + temporal + entities (no separate memoryType call).
- **AC-8** Given API/UI surfaces (capture result, recent captures, confirmation modal, MCP tools,
  agent webhooks, timeline), when data is rendered or returned, then no `memoryType` field is present.

## Scope

**In:** capture/enrich classification, staleness + salience behavior derivation, retrieval/MCP/agents/UI
plumbing removal, evals harness (`requireValidMemoryType` removed — `requireActiveCategories` already
asserts category validity), migration, docs.

**Out:** ontology proposal/evolution UX (future), changing the seeded category vocabulary itself,
retrieval ranking weights (untouched — they never used `memoryType`), `temporal_event` types.

## Migration (0067, same change as schema + journal)

```sql
ALTER TABLE "ontology_entity_kind" ADD COLUMN IF NOT EXISTS "never_stale" boolean DEFAULT false NOT NULL;
UPDATE "ontology_entity_kind" SET "never_stale" = true
  WHERE "kind_type" = 'thought_category' AND "key" IN ('decision','reference','goal','reflection','idea');
ALTER TABLE "thought" DROP COLUMN IF EXISTS "memory_type";
ALTER TABLE "capture_session" ALTER COLUMN "category" DROP DEFAULT;
```

Plus `drizzle/meta/_journal.json` entry (idx 67) and `brain.schema.ts` updates. `npm run db:migrate`
must apply cleanly.

## Test strategy

- **Unit (new/rewritten first):** `thought-staleness` (category-based predicates), bundle parse
  (cues included; AC-1/AC-2), context sanitization (AC-3), interpret parse (no memoryType, repair),
  seed data (AC-5 values), salience filter construction, `extract-search-cues` (re-enrich fallback).
- **Unit (deleted):** `memory-type-catalog`, `classify-memory-type`, `extract-thought-metadata`,
  eval `memory-type-validation` specs; fixture-shape specs stripped of `memoryType`.
- **Integration:** `ontology-db.integration.spec.ts` — `never_stale` seed values; deactivation guard;
  `memory_type` column gone.
- **E2E (headed release):** capture -> enrich -> recent list shows the classified category chip
  (single-axis display) — wired into `src/routes/e2e/release.e2e.ts`.
- **Evals:** operator runs `/eval` UI (Runs -> Reset corpus & start) after merge — not CLI.
