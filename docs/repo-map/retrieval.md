# Domain: Retrieval

**Canonical rule:** Unified retrieval is [`retrieveEvidence`](../../src/lib/server/retrieval/retrieve-evidence.ts). [`searchThoughts`](../../src/lib/server/retrieval/service.ts) is a thin wrapper. MCP `retrieve_thoughts`, HTTP search, and `composeAnswer` all use the same path.

**Embeddings boundary:** Query embeddings are computed in-process for SQL distance only; retrieval outputs are text + scores, never stored thought vectors. See [embeddings-db-only-boundary.md](../planning/embeddings-db-only-boundary.md).

**Query-time baseline (historical):** [retrieval-baseline.md](./retrieval-baseline.md)

**Timing / LLM step breakdown:** [ingest-retrieval-timing.md](../planning/ingest-retrieval-timing.md)

**External references (competitor concepts, local):** [Elastic Atlas](../competitor-concepts/elastic-agent-memory-atlas.md) · [GBrain](../competitor-concepts/gbrain.md) — folder is gitignored.

## Memory tiers and retrieval

See [ingest-retrieval-timing.md § Three memory tiers](../planning/ingest-retrieval-timing.md#three-memory-tiers-capture--recall).

| Tier | Recall at query time |
|------|----------------------|
| **1 — Hot** | FTS on `lexical_text` (+ `cues[]` after tier 2) |
| **2 — Enrich** | pgvector ANN on `thought.embedding`; `thought_entity`, `thought_neighbor` |
| **3 — Consolidation** | `community_summary` ANN + `community_bundle.top_thought_ids`; salience / recency features on `thought` |

**Precomputed artifacts:**

| Artifact | Table / field | Built when |
|----------|---------------|------------|
| Keyword surface | `thought.lexical_text` | Tier 1 (capture) |
| Entity links | `thought_entity` | Tier 2 (enrich) |
| Thought neighbors | `thought_neighbor` | Tier 2 (enrich) |
| Entity → top thoughts | `entity_top_thoughts` | Tier 2 + tier 3 backfill |
| Community bundles | `community_bundle` | Tier 3 (nightly + incremental) |
| Routing summary | `community_summary.summary_short` + embedding | Tier 3 |
| Thought features | `thought.primary_community_ids`, centrality, specificity, recency | Tier 3 |

**Query time (`retrieveEvidence`):** embed query once → parallel ANN + FTS + community ANN → bundle/key fetch → weighted merge → rerank top pool → return top K. **No live AGE reads.**

Tier-1 rows (`enriched_at IS NULL`, no embedding) are intended to surface via **FTS only**. Vector ANN requires `embedding IS NOT NULL`. Same row gains tier 2/3 fields over time — no invalidation.

### Hot-path FTS priority

Tier-1 rows match immediately at SQL. Fusion in [`retrieveEvidence`](../../src/lib/server/retrieval/retrieve-evidence.ts) uses `ts_rank_cd` for thought similarity, zeros graph/community/salience bonuses on expansion-only candidates (no direct lexical or vector hit), and reserves top lexical rows in the rerank pool so keyword matches reach `answer_question` before tier 2 embeds the row.

Apache AGE remains for ingest writes and `/graph` visualization only.

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

- **Purpose:** LLM listwise reranker over top-60 weighted-merge candidates.
- **Status:** Wired in `retrieveEvidence` for all callers. Throws `RerankError` on failure (no silent fallback).

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

- **Purpose:** `fetchRelevantCommunitySummaries` for non-authoritative theme hints in global-scope compose; `searchGlobal` map-reduce retained for reference/tests but **not** used by `composeAnswer`.
- **Status:** Community routing at query time lives in `retrieveEvidence` (bundle expansion). Compose uses theme hints only.

### [`src/lib/server/retrieval/global-query.ts`](../../src/lib/server/retrieval/global-query.ts)

- **Purpose:** LLM `classifyRetrievalScope()` — language-agnostic global vs local intent (no regex/heuristics).

## Community routing (unified + global)

- **All Q&A:** `retrieveEvidence` (vector + lexical + community bundle + entity + neighbor) → strict cited compose with optional grounding profile.
- **Global scope:** higher compose `topK` + `fetchRelevantCommunitySummaries` as non-authoritative theme hints in the prompt (AC-026).
- **Scope routing:** `classifyQueryIntent()` LLM call sets `scope` global vs local before retrieval (any language).

## Reranking

`retrieveEvidence` always reranks top 60 via LLM listwise (`RerankError` on failure). Cross-encoder rerank remains out of scope.

## Eval / test harness

- Retrieval weight sweeps for evals live in [`evals/harness/retrieval-sweep.ts`](../../evals/harness/retrieval-sweep.ts); product search uses [`src/routes/api/retrieval/search/`](../../src/routes/api/retrieval/search/) — keep behavior aligned with `retrieveEvidence`.
