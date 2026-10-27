# Long-text memory: personal vs reference captures, searchable notes

> Parked on branch `benchmark-work` (2026-10-27): not on main.

Status: **approved by the operator 2026-10-25** — Phase A and Phase B built in parallel.
Risk: **critical** (ingestion and retrieval are critical-path domains).

## Problem (evidence)

PersonaMem smoke runs (2026-10-25) showed details in long captures cannot be found:

- Capture forces every capture over 500 chars into "summary thought + note"
  (`LONG_CAPTURE_MIN_CHARS`, `src/lib/server/capture/split-capture-content.ts:31`, `87d3a47d`),
  overriding Jev's `content_role` decision. A long personal entry becomes a one-line summary.
- Notes (`text_file`) are never embedded; they are found only by `to_tsquery('simple', …)` keyword
  match (`src/lib/server/text-files/service.ts:369`). A meaning-based question never reaches them.
- Example: an 854-char email containing "taking an early morning out on the waves" was stored as
  the thought "Professional email follow-up regarding collaboration on gravitational wave
  detection…" plus a keyword-only note; "fun activities on a coastal trip" retrieved nothing.
- A long text that stays one thought gets one embedding (no chunking anywhere) and ≤ 12 entities,
  so a specific detail in it is diluted.

## Decisions (operator, 2026-10-25)

| ID | Decision |
| --- | --- |
| L1 | Jev decides how a capture is stored, by **meaning, not length**: is the whole text personally relevant, reference material, or both? |
| L2 | Three `content_role` answers: **personal**, **reference**, **mixed**. |
| L3 | ~300 chars ("longer than a tweet") is guidance in Jev's criteria, not a rule. The 500-char forced split is **deleted**. |
| L4 | **personal** → split into one thought per distinct thing, each a **verbatim** span of what the user wrote (the LLM only chooses cut points, never rewrites). All enriched into the graph. Short personal captures stay one thought, as today. |
| L5 | **reference** (recipe, template, transcript, pasted document, email written to someone else) → pointer thought + note, as today. The note body never feeds the graph. |
| L6 | **mixed** → the personal spans become thoughts (L4), the reference part becomes a note linked to them (L5). |
| L7 | Notes get searchable passages: table **`note_passage`** (note id, ordinal, text, char range, embedding, lexical index). Same embedding model and 1536-d vectors as thoughts. Short notes = one passage. |
| L8 | Passages: 3–5 sentences (~300–600 chars), cut at paragraph/sentence boundaries (`Intl.Segmenter`, mechanical indexing), one sentence overlap. |
| L9 | On edit: rebuild the note's passages; append-only edits add passages for the new tail only. |
| L10 | Out of scope: LLM fact extraction from notes into the graph; keyword stemming changes. |

## Requirements

### Phase A — Jev content role: personal / reference / mixed

In scope:
- `CONTENT_ROLE_CRITERIA` / instructions (`src/lib/server/llm/decision-plane.ts:129-138`) become
  three choices with the L1–L6 meaning and the ~300-char guidance (L3). Enforced and shadow paths,
  answer validation (`choice` ∈ three values, fail loud otherwise), `decision_shadow_log` rows.
- Delete `LONG_CAPTURE_MIN_CHARS` and `captureSplitMode`'s forced split; the decided mode is final.
- Generation call (`resolveCaptureContentSplit`, `split-capture-content.ts`): for personal and
  mixed, return the personal spans as exact substrings (or char ranges) of the raw text; code
  validates each span is verbatim and non-overlapping (validation only — no meaning decided in
  code); mixed also returns the reference body + title.
- Persisting: reuse the multi-task fan-out mechanism (`src/lib/server/memory/split-multi-task.ts`,
  `splitFrom`/`splitInto` metadata, children via `queueCapture` with the source's capture time) for
  personal/mixed spans. **No duplicate memory:** each span lives in exactly one active thought; the
  original capture stays auditable via `raw_text` (verbatim invariant). Mirror how fan-out treats
  its parent today and state it in the code.
- mixed: the note is linked to the span thoughts (`linkTextFileToThought`).
- Update `docs/repo-map/ingestion.md` (capture split section).

Acceptance (Given/When/Then):
- Given a 900-char journal entry about the user's day with three distinct topics, when it is
  captured, then it is stored as ~3 thoughts whose texts are exact substrings of the input, each
  enriched (entities, graph), and no note is created.
- Given a pasted recipe, when captured, then one pointer thought + a note holding the recipe; no
  entity from the recipe body enters the graph.
- Given "I'm baking this for Mom's 70th, she can't have nuts: <recipe>", when captured, then the
  personal sentence is a thought (Mom, nut allergy in the graph) and the recipe is a linked note.
- Given a 150-char personal thought, when captured, then it is one thought exactly as today.
- Given Jev returns a choice outside the three, when deciding, then the capture fails loud through
  the existing retry policy (no silent default).

### Phase B — `note_passage`: notes searchable by meaning

In scope:
- Migration `drizzle/0083_note_passage.sql` + journal entry + Drizzle schema: `note_passage`
  (`id`, `user_id`, `text_file_id` FK cascade, `ordinal`, `start_char`, `end_char`, `text`,
  `lexical_text`, generated `lexical_tsv` like `thought`, `embedding vector(1536)`, timestamps),
  HNSW cosine index, RLS by `user_id` (same policy shape as `thought`), `npm run db:migrate` +
  `npm run db:rls` apply.
- Chunker (L8), pure and unit-tested. Passage rebuild on create/update, tail-only on append (L9),
  inside the text-file service so every caller (Capture split, Notes UI, chat tools) gets it.
  Embedding cost logged like thought embeddings.
- Retrieval: note passages join hybrid search (vector + lexical) used by `composeAnswer`
  (`src/lib/server/qa/compose-answer.ts:570`), `retrieve_thoughts` text-file hits
  (`src/lib/server/mcp/tools.ts:288`) and `search_text_files`. A hit returns the passage, ±1
  neighbour passage, note title and date; cap passages per note; citations still point to the note.
- Backfill script for existing notes (`scripts/`), idempotent.
- Embeddings stay DB-only (`docs/planning/embeddings-db-only-boundary.md`): never selected for
  tool results, logs or prompts.
- Update `docs/repo-map/ingestion.md` + `retrieval.md` ("no embeddings on text_file" is no longer true).

Acceptance:
- Given a note containing "taking an early morning out on the waves before the keynote", when the
  user asks "what fun activities could I try on a coastal trip?", then that passage is in the
  answer context.
- Given a 3-page note with one specific number in paragraph 7, when asked for that number, then
  the paragraph-7 passage is retrieved (needle test; reuse `qa_surgical_*` style fixtures).
- Given a note is edited, when the edit saves, then its passages match the new text; given a list
  is appended to, then only new passages are embedded.
- Given any MCP tool result or log line, then it contains no embedding values.

## Test plan (tests first)

- Unit: three-way content_role validation; span validation (verbatim, non-overlapping, coverage of
  personal/mixed); forced-split deletion; chunker boundaries/overlap/multilingual; passage rebuild
  vs append; retrieval merge + per-note cap; embedding-free tool results.
- Integration (DB, existing harness patterns): migration applies; RLS isolates `note_passage`;
  capture → passages exist; compose context includes the passage.
- Regression: negative cases — recipe never feeds the graph; short personal thought unchanged.
- E2E: the PersonaMem 35-second smoke (`--evidence-only --answer ask --question-ids
  p78-442433c601f0`) must retrieve the "waves" passage. Operator runs it.

## Phasing

A and B touch different files (A: decision plane, content split, fan-out; B: schema, migration,
text-file service, retrieval) and can be built in parallel by two agents. B alone fixes the
surfing smoke. Each phase: tests first, full `test:unit` / `lint` / `check`, review, commit.
