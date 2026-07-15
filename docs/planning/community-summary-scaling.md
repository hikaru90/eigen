# Community summary scaling (critical)

## Problem

Overnight consolidation generates one LLM chat + one embedding call per community at all hierarchy levels (L2/L1/L0). On sparse graphs this yields hundreds of communities (≈3× entity count) and multi-hour heartbeats. A full graph rewrite also cascades away all summaries when Leiden membership changes slightly.

## In scope

- **L1-only routing summaries** — only domain-level (`COMMUNITY_MID_LEVEL`) communities with ≥2 members and ≥1 linked thought receive LLM reports.
- **Structural eligibility** — member count and thought-link presence are structural gates, not semantic classification.
- **Batched LLM** — multiple eligible communities per structured JSON chat call; batch embeddings via `createThoughtEmbeddings`.
- **Incremental preservation** — community detection diffs member sets and reuses stable community IDs so unchanged summaries survive.
- **Bounded resumable work** — per-run report budget; deferred work resumes next heartbeat without marking the job failed.
- **Manual-link precedence** — `thought_entity` rows with `source='manual'` are never overwritten by ingest backfill.

## Out of scope

- Replacing AGE/Leiden
- Summarizing L2/L0
- String-heuristic semantic routing
- Capture ontology changes

## Acceptance (Given/When/Then)

1. **Given** N eligible L1 communities and batch size B, **when** summaries run, **then** chat calls = `ceil(N/B)` (not N) per full completion.
2. **Given** L2/L0 or singleton/no-thought communities, **when** summaries run, **then** zero LLM calls for those rows.
3. **Given** invalid batch JSON, **when** a batch executes, **then** the batch fails explicitly and no partial rows are written for that batch.
4. **Given** unchanged member set at L1, **when** detection re-runs, **then** community ID and summary row are preserved.
5. **Given** budget exhausted with pending work, **when** heartbeat completes, **then** status shows deferred (not failed) and next run continues.
6. **Given** a manual GTD `thought_entity` link, **when** retrieval backfill runs, **then** no PK conflict and source stays `manual`.

## Risk

**Critical** — changes retrieval routing and overnight graph maintenance.
