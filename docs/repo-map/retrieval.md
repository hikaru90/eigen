# Domain: Retrieval

**Canonical rule:** Server-side hybrid search is implemented in [`src/lib/server/retrieval/service.ts`](../../src/lib/server/retrieval/service.ts) (`searchThoughts`). API route and MCP both call it with explicit weights.

## CompetingSystems

- None inside retrieval merge logic: vector, lexical, and Falkor expansion are composed in one service. For **stack-level** graph duality (AGE enabled vs Falkor used), see **C001** in [conflicts.md](./conflicts.md).

## Key files (scan-first)

### [`src/lib/server/retrieval/service.ts`](../../src/lib/server/retrieval/service.ts)

- **Purpose:** Hybrid retrieval: pgvector distance + lexical FTS + Falkor neighbor/entity expansion, merged with weighted RRF.
- **Owns:** Ranking and score breakdown (`vectorScore`, `graphScore`, fused `score`); candidate limits; seed selection for graph expansion.
- **DependsOn:** `getDb()`, `thought` table, `lexicalSearch`, `reciprocalRankFusion`, Falkor `expandNeighborsByIds` / `expandThoughtIdsFromEntitySeeds`, embedding creation for query string, entity resolution helpers.
- **PublicSymbols:** `searchThoughts`.
- **FailureMode:** Returns empty array when no vector or lexical candidates; LLM/DB errors propagate.

#### `searchThoughts({ userId, query, topK?, weights? })`

- **InputContract:** Non-empty query; `topK` clamped 1–100 inside service; optional weights (see [`src/lib/server/retrieval/index.ts`](../../src/lib/server/retrieval/index.ts) or `CONTEXT_WEIGHTS`).
- **OutputContract:** Array of `{ id, normalizedText, category, score, vectorScore, graphScore, metadata }`.
- **SideEffects:** Read-only on Postgres thought rows; read/query Falkor; creates query embedding (LLM call).
- **Invariants:** Tenant isolation via `userId` in all queries.

### [`src/lib/server/retrieval/lexical.ts`](../../src/lib/server/retrieval/lexical.ts)

- **Purpose:** Lexical / FTS side of hybrid search over `lexical_text`.

### [`src/lib/server/retrieval/fusion.ts`](../../src/lib/server/retrieval/fusion.ts)

- **Purpose:** Reciprocal rank fusion helper for merging ranked lists.

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

## Eval / test harness

- Retrieval presets and weights may be referenced from [`src/routes/evals/`](../../src/routes/evals/) and specs under `src/routes/api/retrieval/search/` — behavior should stay aligned with comments in `searchThoughts`.
