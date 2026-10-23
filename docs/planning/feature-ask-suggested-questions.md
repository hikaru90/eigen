# Feature: suggested questions on Ask (one per thought, from enrichment)

Status: **implemented 2026-10-23** (approved 2026-10-23 — D1 = no backfill, D2 = 3 suggestions).
Migration `drizzle/0077_thought_ask_question.sql`. Edit path note: re-enrich after an edit does
not run the bundle, so the question is rewritten by the existing re-enrich recall call
(`extractRecallCues`, cues + askQuestion in one call — formerly cues-only), not by an extra call.
Risk: **critical** — touches the enrichment pipeline (ingestion is always critical-path).

## 1. Problem

Ask's "Try asking" pills are the user's three most recent thoughts, shortened
(`src/lib/chat/ask-suggestions.ts`, loaded in `src/routes/chat/+page.server.ts`).
A thought ("Call the plumber about the sink") is not a question, so tapping it asks
Ask something that makes no sense.

## 2. Goal

Every enriched thought carries one natural question a person might later ask to get
that thought back ("What did I need to tell the plumber?"). Ask at rest shows the
latest few as tappable suggestions; tapping one asks it.

## 3. Scope

**In scope**

- SQ-1 **No extra LLM call.** Add one field, `askQuestion`, to the existing single
  enrichment call (`enrich_thought_bundle` in
  `src/lib/server/capture/enrich-thought-bundle.ts`), inside its JSON schema and prompt.
  The cost is the extra output tokens of that call, already billed and listed in the
  usage log under `enrich_thought_bundle`.
- SQ-2 **The LLM decides** (no string heuristics): it writes a short question (≤ 90
  characters) in the thought's own language, answerable from this thought alone, in
  the user's perspective ("What did I…", "When is…"). It returns `null` when no
  sensible question exists (e.g. a greeting, a one-word note). Post-LLM code only
  validates type/length and trims whitespace.
- SQ-3 **Storage:** new nullable column `thought.ask_question` plus
  `ask_question_encrypted`, following the same at-rest encryption pattern as
  `cues` / `cues_encrypted`. Migration `drizzle/00NN_thought_ask_question.sql` + journal
  entry + Drizzle schema; existing RLS on `thought` covers it.
- SQ-4 **Ask shows the latest:** page load returns the 3 most recent non-archived
  thoughts with a non-null `ask_question`, newest first; identical question strings
  (after whitespace normalisation) appear once. Tapping one sends it as the question.
  The old `suggestionsFromRecentThoughts` code is deleted.
- SQ-5 **Stays current:** re-enrichment (after an edit via `/api/capture/edit` /
  `edit_thought`) rewrites the question from the new text; forgetting/archiving a
  thought removes its question from Ask.
- SQ-6 **Empty state:** no stored questions → no "Try asking" block (heading only).
  Never fall back to raw thought text.

**Out of scope**

- A separate LLM call or a page-load LLM call; personalised ranking of suggestions;
  questions spanning several thoughts; showing the question anywhere but Ask.

## 4. Contracts

- Enrichment bundle JSON gains `"askQuestion": string | null`. Missing key or wrong type
  is a contract violation handled by the bundle's existing validation/retry path
  (retry exactly 3, then the enrichment fails explicitly as today) — never defaulted.
- `+page.server.ts` for `/chat` returns `suggestions: { thoughtId, question }[]`
  (max 3). Embeddings are never selected.
- MCP: `list_thoughts` / thought reads include `askQuestion` so an agent sees the same
  data (agent benchmark: readable in one call).

## 5. Failure modes

- LLM returns a statement instead of a question, or the thought text copied verbatim →
  covered by prompt rules + regression tests on the prompt contract; code does not try
  to detect it with string rules.
- Enrichment fails → no question for that thought (the thought already shows its
  enrichment failure as today); Ask simply has one fewer suggestion.
- Old thoughts (before this ships) have no question → see D1.

## 6. Acceptance criteria (Given / When / Then)

- AC-1 Given a capture "Call the plumber about the kitchen sink", when enrichment
  completes, then the thought has an `ask_question` that is a question about it (e.g.
  "What did I need to call the plumber about?"), stored encrypted at rest.
- AC-2 Given a German capture, then the question is in German.
- AC-3 Given a capture "hi", then `ask_question` is null and nothing is shown for it.
- AC-4 Given five thoughts with questions, when Ask opens with no conversation, then
  the three newest questions show under the heading, and tapping one asks exactly
  that question.
- AC-5 Given a thought is edited, when re-enrichment finishes, then its question
  reflects the new text; given it is forgotten, then its question no longer appears.
- AC-6 Given no thought has a question, then Ask shows the heading and no suggestions
  — never raw thought text.
- AC-7 Given an enrichment run, then the usage log shows a single
  `enrich_thought_bundle` call (no extra call).

## 7. Test plan

- Unit: bundle schema/parse accepts string|null, rejects other types, trims, enforces
  the length cap; prompt contract includes the askQuestion rules; Ask loader picks 3
  newest, skips null/archived, dedupes exact strings; encryption round-trip.
- Regression (LLM contract, mocked responses): German capture → German question;
  greeting → null.
- Integration: migration applies; enrichment persists `ask_question` under RLS;
  re-enrich updates it.
- E2E (headed release suite, funded harness billing): capture a thought → wait for
  enrichment → Ask shows a question-shaped pill under the heading → tap → the
  conversation starts with that question.
- Agent benchmark: capture → `list_thoughts` shows `askQuestion` → delete → gone.

## 8. Decisions (operator, 2026-10-23)

- **D1:** no backfill; old thoughts get questions only when re-enriched.
- **D2:** 3 suggestions on Ask.

### Original options

- **D1 Existing thoughts:** leave old thoughts without questions (they fill in as new
  thoughts arrive) — **recommended** — or run a one-off billed re-enrich backfill?
- **D2 How many on Ask:** 3 (as today), or a different number?
