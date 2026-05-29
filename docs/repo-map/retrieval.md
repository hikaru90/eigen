# Domain: Retrieval

**Canonical rule:** Server-side hybrid search is implemented in [`src/lib/server/retrieval/service.ts`](../../src/lib/server/retrieval/service.ts) (`searchThoughts`). API route and MCP both call it with explicit weights.

## CompetingSystems

- None inside retrieval merge logic: vector, lexical, and graph (Apache AGE) expansion are composed in one service.

## Key files (scan-first)

### [`src/lib/server/retrieval/service.ts`](../../src/lib/server/retrieval/service.ts)

- **Purpose:** Hybrid retrieval: pgvector distance + lexical FTS + Apache AGE neighbor/entity expansion, merged with weighted RRF.
- **Owns:** Ranking and score breakdown (`vectorScore`, `graphScore`, fused `score`); candidate limits; seed selection for graph expansion.
- **DependsOn:** `getDb()`, `thought` table, `lexicalSearch`, `reciprocalRankFusion`, AGE adapter [`falkor.ts`](../../src/lib/server/graph/falkor.ts) (`expandNeighborsByIds` / `expandThoughtIdsFromEntitySeeds`), embedding creation for query string, entity resolution helpers.
- **PublicSymbols:** `searchThoughts`.
- **FailureMode:** Returns empty array when no vector or lexical candidates; LLM/DB errors propagate.

#### `searchThoughts({ userId, query, topK?, weights? })`

- **InputContract:** Non-empty query; `topK` clamped 1–100 inside service; optional weights (see [`src/lib/server/retrieval/index.ts`](../../src/lib/server/retrieval/index.ts) or `CONTEXT_WEIGHTS`).
- **OutputContract:** Array of `{ id, normalizedText, category, score, vectorScore, graphScore, metadata }`.
- **SideEffects:** Read-only on Postgres thought rows; read/query Apache AGE graph; creates query embedding (LLM call).
- **Invariants:** Tenant isolation via `userId` in all queries.

### [`src/lib/server/retrieval/lexical.ts`](../../src/lib/server/retrieval/lexical.ts)

- **Purpose:** Lexical / FTS side of hybrid search over `lexical_text`.

### [`src/lib/server/retrieval/fusion.ts`](../../src/lib/server/retrieval/fusion.ts)

- **Purpose:** Reciprocal rank fusion helper for merging ranked lists.

### [`src/lib/server/retrieval/reranker.ts`](../../src/lib/server/retrieval/reranker.ts)

- **Purpose:** LLM listwise reranker over top-k RRF candidates (compare excerpts side-by-side; optional recent-capture context).
- **Status:** Implemented and unit-tested; **not wired** into `searchThoughts`, MCP, or `composeAnswer` — see [Reranking (deferred second stage)](#reranking-deferred-second-stage) below.

### [`src/routes/api/retrieval/search/+server.ts`](../../src/routes/api/retrieval/search/+server.ts)

- **Purpose:** Authenticated POST `{ query, topK }`; uses `CONTEXT_WEIGHTS.default`; records retrieval quality telemetry (best-effort).
- **PublicSymbols:** `POST`.
- **FailureMode:** 401; 400 validation errors for query/topK.

### [`src/lib/server/mcp/tools.ts`](../../src/lib/server/mcp/tools.ts)

- **Purpose:** `runRetrieveThoughtsTool` wraps `searchThoughts` with MCP arg validation (`validateSearchParams`); `runAnswerQuestionTool` delegates to QA compose (below).

### [`src/lib/server/qa/compose-answer.ts`](../../src/lib/server/qa/compose-answer.ts)

- **Purpose:** Grounded QA: retrieve then compose natural-language answer (used by MCP `answer_question` and potentially other callers — treat as **retrieval consumer**, not a second search implementation).
- **Owns:** Prompting / composition policy for answers over retrieved context.
- **DependsOn:** `searchThoughts` (or related retrieval entrypoints as implemented in file).

### [`src/lib/server/retrieval/quality-telemetry.ts`](../../src/lib/server/retrieval/quality-telemetry.ts)

- **Purpose:** Best-effort logging of retrieval quality events from API and MCP surfaces.

### [`src/lib/server/retrieval/global.ts`](../../src/lib/server/retrieval/global.ts)

- **Purpose:** GraphRAG-style global sensemaking over precomputed `community_summary` rows (map-reduce LLM).
- **Status:** Implemented and unit-tested; **not wired** into MCP `answer_question`, HTTP retrieval, or chat — see [Global retrieval (deferred)](#global-retrieval-deferred) below.

### [`src/lib/server/retrieval/query-router.ts`](../../src/lib/server/retrieval/query-router.ts)

- **Purpose:** Heuristic classifier (`local` | `relational` | `global`) to pick retrieval path.
- **Status:** Implemented and unit-tested; **not wired** into production callers (same deferral as global search).

## Global retrieval (deferred)

Broad “what are my main themes?” queries are **out of MVP scope**. Requirements lock retrieval to a single default hybrid path (`searchThoughts` only); intent routing and alternate weighting are explicitly deferred ([`01-requirements-baseline.md`](../planning/01-requirements-baseline.md) FR-6, AC-011/013).

`searchGlobal` and `classifyQueryType` exist so the **consolidation index** (`community_summary` rows from nightly REM) has a consumer ready, but wiring waits on:

1. Re-opened requirements + acceptance criteria for global Q&A.
2. Sufficient community summaries for real users (depends on consolidation + entity graph density).
3. Cost policy for map-reduce LLM calls per global query (N community partial answers + 1 reduce).

Until then, `composeAnswer` and MCP always use `searchThoughts`, which handles local/relational questions but not corpus-wide theme synthesis.

## Reranking (deferred second stage)

AC-010 “graph expansion/reranking” means **weighted RRF merge** (vector + lexical + graph into a single ranked list), not a separate reranking model. That first-stage hybrid path is the MVP default and should stay in place.

A second-stage reranker is **optional optimization**, not a substitute for hybrid retrieval:

| Signal | Role |
|--------|------|
| Vector + lexical + graph RRF | First stage — recall and multi-signal fusion (`searchThoughts`) |
| LLM listwise rerank | Second stage — top-k precision when candidates are close in RRF score |
| Fine-tuned / cross-encoder rerank | Post-MVP — explicitly out of scope ([`01-requirements-baseline.md`](../planning/01-requirements-baseline.md) § Out of Scope) |

### Current recommendation (2026-05)

1. **Keep hybrid RRF as the default** for MCP `search_thoughts`, HTTP search, and broad retrieval.
2. **Measure before enabling reranking** — run the eval weight sweep ([`evals/harness/retrieval-sweep.ts`](../../evals/harness/retrieval-sweep.ts); NDCG@10 threshold ~0.5). If default weights already pass, reranking ROI is low.
3. **If reranking is added, start on the QA path only** — wire `rerankCandidates` in `composeAnswer` after RRF, rerank ~15 candidates, take top 8 for answer composition. High top-k precision need; cost is one LLM call per composed answer.
4. **Do not enable globally on MCP search** until evals show a clear lift — cost scales with every search and marginal recall gains are small.
5. **`salienceScore` is not in ranking yet** — bumped on retrieval access but reserved for future weighting; wiring salience into RRF may be cheaper than reranking.
6. **Policy before wiring** — `rerankCandidates` currently returns the original order on LLM/parse failure (silent fallback). That conflicts with the no-fallback guardrail; enable only with explicit failure surfacing or an opt-in flag per call site.

### When reranking helps

- Top-3 / top-8 precision matters (grounded Q&A over retrieved context).
- Many candidates with similar fused RRF scores (embeddings and RRF tie-break poorly).
- Ambiguous queries where side-by-side excerpt comparison beats cosine similarity alone.

### When reranking adds little

- Lexical + graph already surface the right documents at default weights.
- Large `topK` browse/search where recall matters more than order within the tail.
- Eval sweep shows acceptable NDCG@10 without a second stage.

## Eval / test harness

- Retrieval weight sweeps for evals live in [`evals/harness/retrieval-sweep.ts`](../../evals/harness/retrieval-sweep.ts); product search uses [`src/routes/api/retrieval/search/`](../../src/routes/api/retrieval/search/) — keep behavior aligned with `searchThoughts`.
