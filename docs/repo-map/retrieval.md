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
- **`retrieve_thoughts` / `search_text_files`:** same hits (`textFiles` / `results`); the agent-loop compaction keeps `id`, `title`, `createdAt`, `excerpt` of note hits.
- **Embeddings stay DB-only:** every select in the note path lists its columns explicitly and never includes `embedding`; the query vector is used only inside the SQL distance expression.

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
