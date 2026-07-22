# Retrieval query-time baseline (pre-unified path)

Historical reference for what made retrieval slow before `retrieveEvidence` (2026-06).

## Previous query-time cost stack

| Phase              | What ran                                                       | Typical cost driver |
| ------------------ | -------------------------------------------------------------- | ------------------- |
| Embed              | `createThoughtEmbedding` per search pass                       | 1+ LLM calls        |
| Vector             | pgvector HNSW on `thought.embedding`                           | Fast (ms)           |
| Lexical            | FTS on `lexical_text` + `cues`                                 | Fast (ms)           |
| Entity             | `matchCanonicalEntitiesByEmbedding`                            | Fast (ms)           |
| Graph              | AGE `expandNeighborsByIds` + `expandThoughtIdsFromEntitySeeds` | Cypher latency      |
| Temporal           | `filterTemporalEvents` + `traverseTemporalContext`             | SQL + AGE           |
| Hydrate            | Second DB round-trip for graph-only hits                       | Extra query         |
| Decrypt            | Per-thought tenant decrypt across channels                     | CPU                 |
| Compose (Q&A only) | Extra `searchThoughts` passes + hint graph search              | 2–3× retrieval      |

`composeAnswer` could run up to **three** `searchThoughts` calls plus `graphOnlySearchByQuery` hint anchors before compose LLM.

## Target unified path (`retrieveEvidence`)

1. Embed query once
2. Parallel Postgres: thought ANN + lexical + community ANN (L1) + entity ANN
3. Fetch `community_bundle`, `entity_top_thoughts`, `thought_neighbor` (no AGE)
4. Weighted merge → top 60
5. LLM listwise rerank (hard-fail on error)
6. Return top K

Log tag: `[retrieval.retrieveEvidence]` with phase timing from [`phase-timing.ts`](../../src/lib/server/retrieval/phase-timing.ts).

## Precomputed at ingest/background

See [`retrieval.md`](./retrieval.md) § Fast retrieval architecture.
