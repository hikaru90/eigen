# Domain: Retrieval

**Canonical rule:** Unified retrieval is [`retrieveEvidence`](../../src/lib/server/retrieval/retrieve-evidence.ts). [`searchThoughts`](../../src/lib/server/retrieval/service.ts) is a thin wrapper. MCP `retrieve_thoughts`, HTTP search, and `composeAnswer` all use the same path.

**Embeddings boundary:** Query embeddings are computed in-process for SQL distance only; retrieval outputs are text + scores, never stored thought or note-passage vectors. See [embeddings-db-only-boundary.md](../planning/embeddings-db-only-boundary.md).

**Query-time baseline (historical):** [retrieval-baseline.md](./retrieval-baseline.md)

**Timing / LLM step breakdown:** [ingest-retrieval-timing.md](../planning/ingest-retrieval-timing.md)

**External references (competitor concepts, local):** [Elastic Atlas](../competitor-concepts/elastic-agent-memory-atlas.md) · [GBrain](../competitor-concepts/gbrain.md) · [claude-mem — Progressive Disclosure](../competitor-concepts/claude-mem-progressive-disclosure.md) — folder is gitignored.

## Memory tiers and retrieval

See [ingest-retrieval-timing.md § Three memory tiers](../planning/ingest-retrieval-timing.md#three-memory-tiers-capture--recall).

| Tier                  | Recall at query time                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **1 — Hot**           | FTS on `lexical_text` (+ `cues[]` after tier 2)                                                                      |
| **2 — Enrich**        | pgvector ANN on `thought.embedding`; `thought_entity`, `thought_neighbor`                                            |
| **3 — Consolidation** | `community_summary` ANN (**L1 only**) + `community_bundle.top_thought_ids`; salience / recency features on `thought` |

**Precomputed artifacts:**

| Artifact              | Table / field                                                     | Built when                     |
| --------------------- | ----------------------------------------------------------------- | ------------------------------ |
| Keyword surface       | `thought.lexical_text`                                            | Tier 1 (capture)               |
| Entity links          | `thought_entity`                                                  | Tier 2 (enrich)                |
| Thought neighbors     | `thought_neighbor`                                                | Tier 2 (enrich)                |
| Entity → top thoughts | `entity_top_thoughts`                                             | Tier 2 + tier 3 backfill       |
| Community bundles     | `community_bundle`                                                | Tier 3 (nightly + incremental) |
| L1 routing summary    | `community_summary.summary_short` + embedding                     | Tier 3 (batched, budgeted)     |
| Thought features      | `thought.primary_community_ids`, centrality, specificity, recency | Tier 3                         |

**Query time (`retrieveEvidence`):** embed query once → parallel ANN + FTS + community ANN → bundle/key fetch → weighted merge → rerank top pool → return top K. **No live AGE reads on the main merge path** — graph structure reaches queries only via the materialized tables. Exception: temporal-intent queries traverse the AGE Event/INVOLVES graph live via `traverseTemporalContext` ([`temporal.ts`](../../src/lib/server/retrieval/temporal.ts)).

Tier-1 rows (`enriched_at IS NULL`, no embedding) are intended to surface via **FTS only**. Vector ANN requires `embedding IS NOT NULL`. Same row gains tier 2/3 fields over time — no invalidation.

### Hot-path FTS priority

Tier-1 rows match immediately at SQL. Fusion in [`retrieveEvidence`](../../src/lib/server/retrieval/retrieve-evidence.ts) uses `ts_rank_cd` for thought similarity, zeros graph/community/salience bonuses on expansion-only candidates (no direct lexical or vector hit), and reserves top lexical rows in the rerank pool so keyword matches reach `answer_question` before tier 2 embeds the row.

Apache AGE remains for ingest writes and `/memory` graph visualization only.

## Note passages (notes searchable by meaning)

Notes (`text_file`) are not thoughts and are not in `retrieveEvidence`; their **passages** (`note_passage`, see [ingestion.md](./ingestion.md) § Notes) are searched beside it. Entry point: [`searchTextFiles`](../../src/lib/server/text-files/service.ts) -> [`runNoteSearch`](../../src/lib/server/text-files/note-search.ts) (sources injectable; real ones in [`note-passages.ts`](../../src/lib/server/text-files/note-passages.ts)).

- **Signals:** passage pgvector ANN (cosine, top 40) + passage FTS on `lexical_tsv` (top 40) + whole-note keyword match on `text_file.lexical_tsv` (title and body; this is what makes a note findable by its title).
- **Merge and cap** ([`merge-note-passage-hits.ts`](../../src/lib/server/text-files/merge-note-passage-hits.ts) `rankNotePassageHits`): a passage scores `max(cosine similarity, normalizeLexicalRank(ts_rank_cd))` (same lexical normalization as thoughts, now in `rrf-scoring.ts`); passages below the relevance floor are dropped (default `COMPOSE_ANSWER_RELEVANCE_MIN` = 0.22, the same floor thoughts need for Q&A context; `retrieve_thoughts` `threshold` overrides it); at most **3 matched passages per note** (`NOTE_PASSAGES_PER_NOTE_CAP`); notes ranked by their best signal and limited to `topK` (compose: 5).
- **One hit per note:** the hit id is the **note's** id. `excerpt` = matched passages plus their **+-1 neighbour passages** (`NOTE_PASSAGE_NEIGHBOR_RADIUS`), overlap written once, gaps marked `[...]`; the hit also carries title, `createdAt`, `updatedAt`, `matchedOrdinals`, `score`.
- **`composeAnswer`:** each note hit becomes a context item (`category: 'note'`, `id` = note id, text = `Note "<title>": <excerpt>`, `createdAt` = note date), appended after the thought items, so it reaches the answer prompt, `ComposedAnswer.context`, and is citable as `[id=<note id>]`. The query embedding computed for thoughts is reused.
- **Archived notes** (`text_file.archived_at` set, migration `0084`) match in no source (passage ANN, passage FTS, whole-note keyword, note load) and are hidden from `list_text_files`, `get_text_file`, thought attachments and the Notes list; the row is never deleted (restore = clear the column).
- **One retrieval path for Ask and forget:** [`retrieveAnswerEvidence`](../../src/lib/server/qa/retrieve-answer-evidence.ts) is the retrieval half of `composeAnswer` (thoughts hybrid + rerank, note passages, user facts, relevance floor, S3 expansion). The forget flow ([`findForgetHits`](../../src/lib/server/capture/find-forget-hits.ts)) runs it per LLM-derived target phrase with a top-20 pool, restricted to items stored before the forget capture (thoughts and notes by `createdAt`, facts by `factsAsOfBefore`); it has no second fact search, so a fact is exactly one hit.
- **`retrieve_thoughts` / `search_text_files`:** same hits (`textFiles` / `results`); the agent-loop compaction keeps `id`, `title`, `createdAt`, `excerpt` of note hits.
- **Embeddings stay DB-only:** every select in the note path lists its columns explicitly and never includes `embedding`; the query vector is used only inside the SQL distance expression.

## User facts (in answers, F2)

[`searchUserFacts`](../../src/lib/server/facts/search-user-facts.ts) is the hybrid search over `user_fact` (see [ingestion.md](./ingestion.md) § User facts): pgvector ANN + FTS on the folded keyword surface, scored like note passages (best of cosine similarity and the normalised keyword rank) under the same relevance floor, **active facts only** (`forgotten` never matches; `includeSuperseded` adds history). A hit carries the subject, statement (identifier facts: the `[secure:<id>]` reference, never the value), kind, as-of, inferred flag and source ids; selects list their columns and never include `embedding`.

- **Shared retrieval:** `retrieveAnswerEvidence` searches facts beside thoughts and notes and returns `facts`. Own budget `factTopK` (compose: 8, 24 for a corpus-wide `scope: global` question; forget: 20), so facts never take a thought or note slot. With S3 expansion the question and every sub-query search facts (same embeddings, no extra LLM call) and the lists fuse by reciprocal rank inside `factTopK`. The floor is the product floor or the eval override (`relevanceFloorFor`). `authorFilter: 'agent'` searches no facts (facts are about the user). A failing fact search fails the retrieval.
- **`composeAnswer`:** a fact becomes a context item (`kind: 'fact'`, `category: 'fact'`, `id` = fact id, text = `Fact about <subject>: <statement>`, `createdAt` = as-of, `fact: {subject, subjectKind, factKind, inferred}`), after thoughts and notes in `ComposedAnswer.context`; every context item now carries `kind: 'thought' | 'note' | 'fact'`. The user message gets a "Known facts" section (`[id=<fact id>] Fact about … (kind, as of YYYY-MM-DD[, inferred])`); the system prompt gets the known-facts rules **only when facts were retrieved** (facts about other people are not the user's; no identifier in an answer unless asked, then the `[secure:<id>]` token; "what do you know about me?" answered from the facts, grouped by theme and person, on the single Answer line). A question without facts is byte-identical to before.
- **Secure values never reach a model:** the prompt, the context, logs and `ComposedAnswer.answer` hold only the `[secure:<id>]` reference. [`resolveSecureReferences`](../../src/lib/server/facts/secure-values.ts) replaces it with the value (a gone one with `[no longer stored]`) at exactly two places, both after generation: the Ask response in [`handle-agent-chat-post.ts`](../../src/lib/server/chat/handle-agent-chat-post.ts) (streamed `done.response` and JSON `response`) and the display read of a stored session ([`loadChatSession`](../../src/lib/server/chat/chat-sessions.ts)). The stored assistant turn, `runAskTurn().answer`, the agent messages and the eval harness keep the token (the next turn's model reads stored turns). `secure-value-boundary.spec.ts` pins the callers. `answer_question` is not exposed on HTTP MCP and `retrieve_thoughts` returns no facts.
- **PersonaMem harness:** the chooser reads `composed.context`, so facts reach it as `[i] (stored YYYY-MM-DD) Fact about <subject>: <statement>`; `answers.jsonl` items carry `kind`.

## CompetingSystems

- None: one merge path in `retrieveEvidence`.

## Key files (scan-first)

### [`src/lib/server/retrieval/retrieve-evidence.ts`](../../src/lib/server/retrieval/retrieve-evidence.ts)

- **Purpose:** Unified retrieval for all surfaces.
- **PublicSymbols:** `retrieveEvidence`.
- **DependsOn:** `lexicalSearch`, `community_bundle`, `entity_top_thoughts`, `thought_neighbor`, `rerankCandidates`, pgvector HNSW indexes.
- **FailureMode:** Propagates DB/LLM/rerank errors; reranker hard-fails (no silent reorder).

### [`src/lib/server/retrieval/service.ts`](../../src/lib/server/retrieval/service.ts)

- **Purpose:** Back-compat wrapper delegating to `retrieveEvidence`.
- **PublicSymbols:** `searchThoughts`, `RetrievalResult`.

### [`src/lib/server/retrieval/lexical.ts`](../../src/lib/server/retrieval/lexical.ts)

- **Purpose:** Lexical / FTS side of hybrid search over `lexical_text` plus `cues[]` (OR-joined tokens).

### [`src/lib/server/retrieval/fusion.ts`](../../src/lib/server/retrieval/fusion.ts)

- **Purpose:** Reciprocal rank fusion helper (legacy; not used by `retrieveEvidence`).

### [`src/lib/server/retrieval/reranker.ts`](../../src/lib/server/retrieval/reranker.ts)

- **Purpose:** LLM listwise reranker over a top-15 pool (`RERANK_POOL`) with a 5-slot lexical reserve (`buildRerankPool`). Skipped by `shouldSkipRerank` when fusion scores already separate winners (top-2 gap ≥ 0.15) or ≤ 1 candidate.
- **Status:** Wired in `retrieveEvidence` for all callers. Throws `RerankError` on failure (no silent fallback — surfaces as HTTP 500 on search/API by design).

### [`src/lib/server/retrieval/materialize-links.ts`](../../src/lib/server/retrieval/materialize-links.ts)

- **Purpose:** Populate `thought_entity`, `thought_neighbor`, `entity_top_thoughts` at enrich/consolidation.

### [`src/lib/server/consolidation/community-bundles.ts`](../../src/lib/server/consolidation/community-bundles.ts)

- **Purpose:** Build `community_bundle` rows from `thought_entity` joins (not substring scan).

### [`src/lib/server/consolidation/incremental-consolidation.ts`](../../src/lib/server/consolidation/incremental-consolidation.ts)

- **Purpose:** Dirty community refresh after enrich (not only nightly cron).

### [`src/routes/api/retrieval/search/+server.ts`](../../src/routes/api/retrieval/search/+server.ts)

- **Purpose:** Authenticated POST `{ query, topK }`; records retrieval quality telemetry (best-effort).
- **PublicSymbols:** `POST`.

### [`src/lib/server/mcp/tools.ts`](../../src/lib/server/mcp/tools.ts)

- **Purpose:** `runRetrieveThoughtsTool` wraps unified retrieval. `runAnswerQuestionTool` calls `composeAnswer` (retrieve + compose LLM).

### [`src/lib/server/qa/compose-answer.ts`](../../src/lib/server/qa/compose-answer.ts)

- **Purpose:** Grounded QA: all queries → `searchThoughts` / `retrieveEvidence`, grounding profile when present, strict cited compose. Global scope uses higher `topK` and non-authoritative community theme hints — not `searchGlobal` map-reduce.
- **DependsOn:** `searchThoughts`, `fetchRelevantCommunitySummaries`, `classifyQueryIntent`, `loadGroundingProfileForEnrichment`; temporal validity helpers in [`temporal-validity.ts`](../../src/lib/server/memory/temporal-validity.ts).

### [`src/lib/server/retrieval/quality-telemetry.ts`](../../src/lib/server/retrieval/quality-telemetry.ts)

- **Purpose:** Best-effort logging of retrieval quality events from API and MCP surfaces.

### [`src/lib/server/retrieval/global.ts`](../../src/lib/server/retrieval/global.ts)

- **Purpose:** `fetchRelevantCommunitySummaries` for non-authoritative theme hints in global-scope compose. The retired `searchGlobal` map-reduce (and `hasCommunitySummaries`) was deleted 2026-07-22 per the qa-grounding-hardening decision (2A); community routing at query time lives in `retrieveEvidence` (bundle expansion).

### [`src/lib/server/retrieval/global-query.ts`](../../src/lib/server/retrieval/global-query.ts)

- **Purpose:** LLM `classifyRetrievalScope()` — language-agnostic global vs local intent (no regex/heuristics).

## Community routing (unified + global)

- **All Q&A:** `retrieveEvidence` (vector + lexical + community bundle + entity + neighbor) → strict cited compose with optional grounding profile.
- **Global scope:** higher compose `topK` + `fetchRelevantCommunitySummaries` as non-authoritative theme hints in the prompt (AC-026).
- **Scope routing:** `classifyQueryIntent()` LLM call sets `scope` global vs local before retrieval (any language).

## Reranking

`retrieveEvidence` reranks a 15-candidate pool (plus 5 lexical-reserve slots) via LLM listwise, unless `shouldSkipRerank` fires (≤ 1 candidate or top-2 score gap ≥ 0.15). Throws `RerankError` on failure. Cross-encoder rerank remains out of scope.

## Eval / test harness

- Retrieval weight sweeps for evals live in [`evals/harness/retrieval-sweep.ts`](../../evals/harness/retrieval-sweep.ts); product search uses [`src/routes/api/retrieval/search/`](../../src/routes/api/retrieval/search/) — keep behavior aligned with `retrieveEvidence`.
