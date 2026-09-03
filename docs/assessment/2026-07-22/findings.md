# Architecture & Test Assessment — 2026-07-22

Scope: ingest architecture, retrieval architecture, data layer (Postgres 16 + pgvector + Apache AGE + Drizzle + RLS), and the test suite. Method: direct code review plus four parallel specialist analyses (ingest, retrieval, data layer, test quality); every load-bearing claim re-verified against code. Full unit suite executed: **426 files, 2665 passed / 7 failed / 4 skipped** (16.4s).

**Overall verdict: the architecture fundamentally makes sense.** Tiered ingest (hot persist → background enrich → nightly consolidation), materialized zero-traversal hybrid retrieval, and the no-fallbacks failure policy are coherent and mostly honored in code. The problems are in the seams: tenant-isolation _testing_ is broken, several RLS defense-in-depth gaps, dead code from pivots, and doc drift.

Domain scores (1–5): ingest 4 arch / 3 tests · retrieval 4 arch / 3 tests · data layer 4 arch / 3 tests · test strategy 3.5 overall.

---

## 1. Severity-ordered findings

### S1 — RLS integration tests fail wherever a DB exists, and silently skip in CI

- The 4 real-DB integration specs (`src/lib/server/retrieval/retrieval.integration.spec.ts`, `src/lib/server/ontology-db/ontology-db.integration.spec.ts`, `src/lib/server/db/tenant-secrets.integration.spec.ts`, `src/lib/server/billing/wallet-rls.integration.spec.ts`) plus `src/lib/server/memory/thought-lifecycle-filter.spec.ts` seed `user` rows via `withEvalDb(userId, …)` — a **tenant-scoped** connection (`SET ROLE eigen_app` + GUC). The `user` table has `FORCE ROW LEVEL SECURITY` with only a SELECT policy (`src/lib/server/db/enable_rls.sql:6-11`), so the seed insert is denied: `new row violates row-level security policy for table "user"`. **7 tests red.**
- Production signup is unaffected: Better Auth uses the dedicated superuser pool (`src/lib/server/db/auth-db.ts:6-9`). This is a **test-harness bug** — identity rows must be seeded via an operator connection, not a tenant session.
- The specs are `describe.skipIf(!process.env.DATABASE_URL)` (e.g. `retrieval.integration.spec.ts:24-26`) and CI (`.github/workflows/test-coverage.yml`) provides no database → **tenant isolation, a non-negotiable guardrail, has no green automated verification anywhere.**

### S2 — RLS policy gaps on 7 user-data tables; RLS not part of migrations

Verified directly against `enable_rls.sql` (42 tables covered) and `brain.schema.ts`:

| Table                                                                           | Tenant data                     | Policy                                             |
| ------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| `thought_entity`, `thought_neighbor`, `entity_top_thoughts`, `community_bundle` | yes (retrieval materialization) | **none**                                           |
| `agent_project_binding`, `feedback` (`brain.schema.ts:1813`)                    | yes                             | **none**                                           |
| `eval_qa`                                                                       | eval corpus                     | **none** (other eval tables have policies)         |
| `consolidation_run`                                                             | intentionally global ledger     | none (by design)                                   |
| `user`                                                                          | Better Auth identity            | SELECT-only (by design; writes via superuser pool) |

Today isolation on the materialization tables rests solely on app-level `user_id` filters — one missed filter = cross-tenant leak, no defense-in-depth. Separately, RLS lives **only** in `enable_rls.sql`, applied by `scripts/apply-rls.mjs`, not in Drizzle migrations — a deploy that skips `db:rls` has zero isolation and nothing detects that.

### S3 — Tier-1 capture is not atomic; AGE failure produces duplicate rows

`queueCapture` (`src/lib/server/capture/queue-capture.ts:111-157`): `capture_session` insert → `thought` insert (two separate statements) → AGE `upsertThoughtNode` → `scheduleCaptureEnrichWorker`. If the AGE upsert throws: HTTP 500, but the row is committed, **no enrich worker is scheduled**, and the client queue retries the submit → **duplicate thought rows**; the original row also never gets its graph anchor (enrich passes `skipThoughtNodeUpsert: true`, `enrich-queued-thought.ts:257`).

### S4 — Hand-rolled Cypher escaping is the only AGE injection defense, and it is untested

AGE has no parameter protocol; `renderCypherQuery` textually substitutes `$param` via `toCypherLiteral` (`src/lib/server/graph/age-cypher.ts:19-43`). No hostile-input tests (quotes, backslashes, dollar-quote collisions, unicode). AGE tenancy is convention-only (`assertTenantScopedCypherParams` requires `params.user_id === userId`, `:91-104`) because AGE has no RLS; the app role has full DML on the graph schema, so one missing `user_id` filter = cross-tenant graph read.

### S5 — Nondeterministic neighbor expansion in retrieval

`retrieve-evidence.ts:447-469`: `thought_neighbor` query has **no `ORDER BY weight`**, a global `LIMIT 40`, then an in-memory cap of 2 per seed over unspecified row order. Which neighbors survive is arbitrary and not weight-ordered.

### S6 — Retrieval score-math inconsistencies

- Flat `temporalBoost = 0.18` (`retrieve-evidence.ts:548`) sits outside `SCORE_WEIGHTS` (which sum to 1.0, `:60-68`), so raw merge scores reach 1.18 while `MAX_RETRIEVAL_MERGE_SCORE = 1` (`rrf-scoring.ts:7`) claims otherwise; `normalizeRetrievalScore` silently clamps.
- `redundancyPenalty` (`:192-205`) is **iteration-order-dependent**, penalizes a candidate when _any_ previously seen community has count > 2 (regardless of the candidate's own membership), and counts duplicate ids inside a row's `primaryCommunityIds` (spec fixtures exploit this: `retrieve-evidence.spec.ts:113,238`).
- Magic calibration constants: `normalizeLexicalRank = min(1, raw*2.5)` (`:116-119`), 0.35/0.2 fallbacks (`:140`).

### S7 — Dead code and stubbed pipelines

- `src/lib/server/retrieval/fusion.ts` (`reciprocalRankFusion`) — imported only by its own spec. Docs still advertise "RRF".
- `rrf-scoring.ts`: `RRF_K`, `maxFusedRrfScore`, `normalizeFusedRrfScore` `@deprecated` but still exported/tested.
- Temporal scheduling-conflict pipeline decommissioned to a stub: `isSchedulingConflictQuery` always `false` (`temporal-conflicts.ts:28-30`) → call sites in `retrieve-evidence.ts:472-480` and `compose-answer.ts:688-692` unreachable; whole module (AGE conflict traversal, Postgres overlap, prompt formatter) is dead, incl. `findTemporalSchedulingConflictsInGraph` in `age.ts`.
- `detectContradictions` returns `[]` (`compose-answer.ts:181-183`); only `detectStoredThoughtContradictions` is live.
- `inferQueryTimeRange` deprecated stub returning null (`temporal.ts:51-57`).
- `searchGlobal` map-reduce unused by `composeAnswer` (`global.ts:101+`); only specs call it. `hasCommunitySummaries` likewise only spec-referenced.
- `persistCapturedThought` in `capture/service.ts` — zero production callers (verified); ironically contains the only content near-dup detection (distance < 0.06). Dead.
- `retrieve-evidence.ts:386-390` dead `void m` loop; `bundleRank` recorded on candidates and hydrated (`:416,:512`) but never used in scoring.
- `docs/planning/qa-grounding-hardening.md` already decided the retirement (option 2A) — the code never finished the job.

### S8 — Doc drift (docs are load-bearing in this repo)

- `docs/repo-map/index.md:9` — "Hybrid search (vector + lexical + AGE graph RRF)": production uses a **weighted merge**, and the main merge path does not read AGE.
- `docs/repo-map/retrieval.md:73,123` — "reranker over top-60, always reranks": code is `RERANK_POOL = 15` + 5-slot lexical reserve (`retrieve-evidence.ts:58,148-173`) and `shouldSkipRerank` skips the LLM call when the top-2 gap ≥ 0.15 (`reranker.ts:33-37`).
- `docs/repo-map/retrieval.md:35` — "No live AGE reads": false for temporal queries (`traverseTemporalContext` → `temporal.ts:323` reads AGE live at Q&A time).
- `.github/workflows/test-coverage.yml` coverage-job comment claims "~75% critical"; the ratcheted floor is 89% lines (`vite.config.ts:102-108`).
- Community detection is app-side Leiden (`consolidation/leiden.ts`), not "Louvain/AGE" as older docs say.

### S9 — Ingest failure-policy cracks

- Fatal classification string-matches `error.message.includes('LLM HTTP 402')` (`src/lib/server/ingest/retry.ts:30`) because `llm-client` throws untyped ``Error(`LLM HTTP ${status}: …`)``. A message-format change silently turns billing failures into retried ones.
- Enrich crash recovery is lazy and in-process: `activeWorkers` is a `Map` (`capture-enrich-worker.ts:9`) — single-instance assumption; stale rows wait for the next capture/poll sweep (10-min requeue, `queue-capture.ts:252-298`).
- Client queue gives 3 total attempts (`src/lib/capture/queue/process-item.ts`) vs server's 1+3 — an unaligned reading of "retry 3 times".
- `enrich.ts:160-172,308-322` swallows ontology-refresh/grounding-notify failures to console-only.

### S10 — Coverage enforcement and test-infrastructure gaps

- Critical-tier floors are ratcheted to 89/77/90/87 vs the 95% target (`vite.config.ts:95-134`) and the CI coverage job is `continue-on-error: true` → even the floors don't block merge.
- Coverage **excludes** `consolidation/**`, `graph/**`, `ontology/**`, `api-keys/**`, `capture/queue/**` (`vite.config.ts:66-74`) although the guardrails doc lists `graph` as high tier. Test:source ratios: consolidation 0.28, db 0.20, graph 0.18.
- 112 spec files mock `getDb()` with hand-rolled per-file chain doubles; the fakes ignore `WHERE` clauses — e.g. the enrich-claim CAS guard could be deleted and tests stay green. The documented `thenableWhere` helper is used in only 4 files.
- Untested high-value targets: `src/lib/server/db/tenant-session.ts` (**the isolation mechanism itself**), `activity/trace-cost.ts` + `gateway-providers.ts` (billing transparency core), `graph-sync-worker.ts` (its spec is 12 lines asserting `3+1=4`), 21 non-excluded `+server.ts` routes incl. `api/thoughts/[thoughtId]`.
- E2E (14 files) is operator-run only; no capture→enrich→search round-trip or MCP journey in CI; 2 of 7 component specs in the merge gate.
- No static guard spec banning string-heuristic patterns in production code (policy is docs-only; `assert:oss-secrets` shows the pattern).

### S11 — Structural observations (judgment calls, not bugs)

- **Two graph representations**: AGE (viz, temporal traversal, consolidation source, export) + relational materialization for the hot retrieval path. Defensible for query-time performance, but retrieval correctness silently depends on materialization freshness, and `entity_resolution_log` is the reconstruction source of truth. Should be documented as a deliberate decision.
- pgvector: consistent `vector(1536)` + HNSW `vector_cosine_ops` on all four embedding columns and `<=>` cosine everywhere — **correct**; missing `hnsw.ef_search` tuning and `ANALYZE`/maintenance.
- Rerank failure = hard 500 on search (`RerankError` uncaught in `src/routes/api/retrieval/search/+server.ts`) — intended no-fallback policy, but it couples all search availability to the LLM gateway; `shouldSkipRerank` mitigates cost/latency.
- Duplicate plaintext + `*_encrypted` columns increase leak surface (transitional envelope-encryption design).
- Per-capture LLM calls have no token budgets; concurrent identical captures produce duplicate rows + embeddings (no live-path dedup since `persistCapturedThought` is dead).

## 2. What is genuinely strong

- Enrich queue: correct CAS claim (`queue-capture.ts:188-220`), layered stuck-row recovery (`sync-capture-enrich-queue.ts`), exact 1+3 retry with explicit exhaustion (`ingest/retry.ts:38-67`), content-split verbatim invariant enforced in code and tested (`split-capture-content.ts:170-172`).
- Retrieval: one unified path for MCP/HTTP/compose (`retrieveEvidence`), true 6-way parallel candidate fan-out, `directRelevanceMultiplier` correctly deflates expansion-only candidates, tier-1 rows retrievable via FTS-only, embeddings-DB-only enforced by select shapes + `sanitizeMcpToolResult`.
- Data layer: hash-based fail-fast migration runner with journal assert (66/66 consistent), disciplined RLS session pattern (SET ROLE + FORCE RLS), idempotent consolidation ledger, dual-scheduler redundancy.
- Tests: critical-domain spec density >1.0; policy invariants really tested (GTD judge negatives `judge-gtd-project.spec.ts:92-96`, embedding boundary, secret redaction, `requireAssertions: true`); coverage floors ratcheted to measured values so regressions fail.
