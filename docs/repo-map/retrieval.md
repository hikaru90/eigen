# Domain: Retrieval

**Canonical rule:** Unified retrieval is [`retrieveEvidence`](../../src/lib/server/retrieval/retrieve-evidence.ts). [`searchThoughts`](../../src/lib/server/retrieval/service.ts) is a thin wrapper. MCP `retrieve_thoughts`, HTTP search, and `composeAnswer` all use the same path.

**Embeddings boundary:** Query embeddings are computed in-process for SQL distance only; retrieval outputs are text + scores, never stored thought vectors. See [embeddings-db-only-boundary.md](../planning/embeddings-db-only-boundary.md).

**Query-time baseline (historical):** [retrieval-baseline.md](./retrieval-baseline.md)

## Fast retrieval architecture

**Ingest/background (precompute):**

| Artifact | Table / field | Built when |
|----------|---------------|------------|
| Entity links | `thought_entity` | Enrich |
| Thought neighbors | `thought_neighbor` | Enrich |
| Entity → top thoughts | `entity_top_thoughts` | Enrich + consolidation |
| Community bundles | `community_bundle` | Consolidation + incremental |
| Routing summary | `community_summary.summary_short` + embedding | Consolidation |
| Thought features | `thought.primary_community_ids`, centrality, specificity, recency | Consolidation |

**Query time (`retrieveEvidence`):** embed once → parallel ANN/FTS → bundle/key fetch → weighted merge → rerank top 60. **No live AGE reads.**

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

- **Purpose:** Grounded QA: one `searchThoughts` / `retrieveEvidence` call, then compose LLM.
- **DependsOn:** `searchThoughts`; temporal validity helpers in [`temporal-validity.ts`](../../src/lib/server/memory/temporal-validity.ts).

### [`src/lib/server/retrieval/quality-telemetry.ts`](../../src/lib/server/retrieval/quality-telemetry.ts)

- **Purpose:** Best-effort logging of retrieval quality events from API and MCP surfaces.

### [`src/lib/server/retrieval/global.ts`](../../src/lib/server/retrieval/global.ts)

- **Purpose:** GraphRAG map-reduce over `community_summary` (legacy). **Not wired** to production.

### [`src/lib/server/retrieval/query-router.ts`](../../src/lib/server/retrieval/query-router.ts)

- **Purpose:** Heuristic classifier (`local` | `relational` | `global`). Not used for retrieval routing.

## Community routing (unified)

- **L1** community ANN selects routing communities (`summary_short` embedding).
- **L2/L3** `community_bundle.top_thought_ids` expand evidence without graph traversal.
- `searchGlobal` map-reduce remains unwired.

## Reranking

`retrieveEvidence` always reranks top 60 via LLM listwise (`RerankError` on failure). Cross-encoder rerank remains out of scope.

## Eval / test harness

- Retrieval weight sweeps for evals live in [`evals/harness/retrieval-sweep.ts`](../../evals/harness/retrieval-sweep.ts); product search uses [`src/routes/api/retrieval/search/`](../../src/routes/api/retrieval/search/) — keep behavior aligned with `retrieveEvidence`.
