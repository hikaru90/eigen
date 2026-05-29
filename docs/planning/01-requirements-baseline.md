# Eigen Requirements Baseline (MVP)

## Problem Statement
People capture thoughts across tools, but memory becomes fragmented and locked into vendor ecosystems. Users need a portable memory layer they own, where thoughts can be captured quickly, enriched by AI, and queried from any compatible client.

## Product Goals
- Make capture frictionless: raw thought in, structured memory out.
- Preserve data sovereignty and portability across AI tools.
- Provide transparent, usage-based pricing per infrastructure call.
- Enable better retrieval quality with immediate graph + vector combination.
- Keep behavior deterministic with no silent degradation paths.
- Use deterministic LLM retries (exactly 3 attempts) against the configured LLM gateway.

## Personas
- Individual operator: captures ideas/tasks/notes and queries memory daily.
- Knowledge worker: uses AI clients and needs persistent shared memory context.
- Power user: wants inspectable cost logs and control over data portability.

## In Scope (MVP)
- Universal SvelteKit application (frontend + backend routes).
- Capture/ingest interface with single-submit loop:
  - User submits raw thought (text or voice).
  - System stores the thought immediately.
  - System returns a natural-language description of how it was stored.
  - User may submit a natural-language edit request to update storage.
- Voice ingest:
  - Browser-side speech-to-text transcription is used in MVP.
  - Transcription runs in the client browser, not on Eigen backend.
  - No server-side transcription compute billing is allowed in MVP.
  - Audio capture is transcribed before metadata extraction/classification/embedding.
  - Transcription failures follow ingest retry policy (3 retries, then explicit error).
- Thought storage and retrieval:
  - PostgreSQL as system of record.
  - `pgvector` semantic retrieval (cosine kNN over stored embeddings).
  - **Apache AGE** (OpenCypher in Postgres) for memory graph edges and graph expansion during retrieval (`AGE_GRAPH_NAME`, default `eigen_graph`); relational `thought_relation` remains in Postgres for SoR.
  - Immediate **hybrid** retrieval from day one: **semantic** channel = pgvector + lexical (`ts_rank_cd` over precomputed `lexical_text` / `tsvector`), fused with **graph** channel (neighbor expansion + entity-anchored paths), merged via weighted reciprocal rank fusion (default **0.7** on the combined semantic RRF contribution, **0.3** on graph RRF — see AC-012).
  - Deterministic **lexical search surface** on stored thoughts (`lexical_text` derived from normalized text) for Postgres `tsvector` / keyword fusion with semantic search.
  - **Retrieval quality diagnostics (metadata-only):** each search may persist numeric channel diagnostics (e.g. semantic share for top results) in Postgres for effectiveness tracking; **no** query text, thought bodies, thought ids, or embeddings in that row (GDPR-aligned).
  - **MCP and ingest validation:** strict entity IDs and numeric search bounds at the tool boundary; **redaction** of secret-shaped fields in logs and telemetry tied to pricing transparency.
- MCP v1 tools:
  - `capture_thought`
  - `list_thoughts`
  - `search_thoughts`
  - `edit_thought`
- Activity/cost log:
  - Per-call LLM gateway usage log.
  - Per-call cost breakdown.
  - Explicit per-call markup (initial 20%).
- LLM gateway strategy:
  - All LLM calls route through the configured LLM base URL (gateway).
  - Chat and embedding calls use gateway rule UUIDs (`LLM_RULE_CHAT`, `LLM_RULE_EMBEDDING`); each rule carries model and routing configuration.
  - Per-call base cost is computed from response token usage (no per-model env table).
  - Retry up to exactly 3 times per LLM call (same model; no switching model family on failure).
- Security and tenancy:
  - Better Auth.
  - `user_id` tenancy key.
  - Row Level Security (RLS).
- Ontology:
  - Baseline categories (`thought`, `task`, `idea`, `reference`, `date`, `person`).
  - Re-evaluate after 10 captured thoughts.
- UI:
  - Capture/ingest page.
  - Activity/cost log page.
  - Knowledge graph visualization as high-priority MVP candidate.

## Out of Scope (MVP)
- Advanced analytics dashboards.
- Sharing/collaboration features.
- Complex workflow automations.
- Fine-tuned reranking optimization (LLM listwise second stage is documented but deferred — see [`docs/repo-map/retrieval.md`](../repo-map/retrieval.md#reranking-deferred-second-stage)).
- Deep observability/audit tooling.

## Functional Requirements
1. Capture thoughts through a dedicated interface (text and voice).
2. Use browser-side transcription for voice input before persistence.
   - Transcription execution target: browser runtime.
   - Backend accepts transcript text, never raw audio for transcription.
3. Persist on submit and return a natural-language "stored result" summary.
4. Support natural-language post-submit edits from UI and MCP.
5. Provide list/search/edit MCP operations.
6. Route retrieval (MVP lock):
   - Single default mode only: vector-first then graph expansion.
   - Relation-centric routing, intent classification, and alternate weighting are deferred until explicitly re-scoped.
7. Apply deterministic context selection weights for the default mode:
   - Default queries: **0.7** on the combined semantic (vector + lexical) RRF score and **0.3** on the graph RRF score (product shorthand: `0.7 vector + 0.3 graph`; see AC-012).
8. Log all relevant LLM/API calls with transparent pricing details.
9. Log transcription calls (including client runtime cost footprint) in activity log.
   - For browser transcription, log client runtime metadata (model id, latency, retry count, device class)
     and set backend transcription cost to zero.
10. Apply and display per-call markup policy.

## Non-Functional Requirements
- Reliability:
  - Deterministic retry policy: exactly 3 retries for every LLM call.
  - On final failure, return clear, easy-to-understand error.
- Performance:
  - MVP relaxed p95 target: capture (text submit) <= 8s, retrieval <= 8s.
  - MVP relaxed p95 target: capture (voice + browser transcription) <= 12s on target devices.
- Client capability:
  - Must detect unsupported browsers/devices and fail with explicit actionable guidance.
- Security:
  - Better Auth + RLS isolation by `user_id`.
- Portability:
  - Export/import primitives for thoughts + metadata + embeddings.
- Determinism:
  - No silent fallback behavior.
  - Stable retrieval routing criteria for the same intent class.

## Architecture Constraints
- ORM: Drizzle.
- E2E testing: Playwright.
- UI primitives: shadcn-svelte.
- Mutation pattern: native client fetch to explicit `+server` endpoints by default.
