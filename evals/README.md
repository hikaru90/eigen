# Eigen Evals

Local-on-demand harness for retrieval and answer-quality evaluation.
Designed to be promotable to nightly/PR-gating later without rewrites.

## What it measures

1. **Retrieval ablation** — sweeps the `searchThoughts` weight from `1.0/0.0`
   (vector-only) to `0.0/1.0` (graph-only), reporting Recall@5, Recall@10,
   NDCG@10, and MRR overall and per query category. Answers
   "is semantic better or worse than graph?" empirically and tells you whether
   the current `0.7/0.3` default is justified.

2. **Answer quality** — wraps `composeAnswer` (server-side RAG path) and judges
   each generated answer on three criteria:
   - faithfulness (1..5)
   - relevance (1..5)
   - usefulness (1..5)

## Layout

```
evals/
  datasets/
    retrieval/
      corpus.yaml            # ~75 thoughts in 6 named-entity clusters
      relations.yaml         # ~60 graph edges (required for graph signal)
      queries.yaml           # 30 queries: semantic_paraphrase / entity_relation / hybrid
      embeddings.cache.json  # gitignored; populated on first seed
    answer/
      qa-cases.yaml          # ~25 cases reusing the retrieval corpus
  harness/
    seed-fixtures.ts         # idempotent DB seed for retrieval fixtures
    retrieval-eval.ts        # weight-sweep ablation runner
    answer-eval.ts           # composeAnswer + judge runner
    judge.ts                 # LLM-as-judge wrapper (temp 0, structured JSON)
    metrics.ts + .spec.ts    # pure NDCG/Recall/MRR
    dataset.ts               # YAML loaders
    eval-context.ts          # RLS-aware async-local DB context
    eval-config.ts           # stable user ids
    report.ts                # JSON report writer
  baselines/                 # checked-in baseline reports
  reports/                   # gitignored; per-run timestamped reports
  vite.config.ts             # standalone vite-node config (no SvelteKit plugin)
```

## Prerequisites

- Local Postgres up: `npm run db:up`
- Schema applied: `npm run db:init`
- `.env` configured with:
  - `DATABASE_URL`
  - `LLM_BASE_URL`, `LLM_API_KEY` (OpenAI-compatible gateway)
  - `LLM_RULE_CHAT`, `LLM_RULE_EMBEDDING` (gateway rule UUIDs)

## Running

```bash
npm run eval:seed         # idempotent: seeds eval-runner-retrieval user + thoughts + relations
npm run eval:retrieval    # weight sweep + report
npm run eval:answer       # composeAnswer + judge + report
npm run eval:all          # all of the above
```

Reports land in `evals/reports/`. To promote a successful run to a
checked-in baseline:

```bash
npm run eval:baseline retrieval   # copies retrieval-latest.json -> baselines/retrieval.json
npm run eval:baseline answer
npm run eval:baseline both
```

## Failure semantics

The harness honors the project's no-fallback guardrails:

- LLM failures bubble up after the existing 3-retry budget; eval cases fail
  loud rather than silently skip.
- DB seed conflicts on existing fixtures update in place; relations are
  replaced rather than merged.
- Embedding cache misses are regenerated and persisted; the cache never
  silently substitutes a different embedding model.
- Judge calls go through `logActivityCall` under `EVAL_JUDGE_USER_ID` so
  eval spend is queryable and isolated from real-user activity.

## Extending

- New retrieval queries: add to `queries.yaml` with graded relevance labels.
- New answer cases: add to `qa-cases.yaml`. Each case needs an `id`,
  `question`, and `expected_facts` list.
- Pure-graph-only retrieval arm (entity-extraction-driven seeding) is
  intentionally out of scope; the weight sweep at `0.0/1.0` zero-weights the
  vector score but still uses vector seeding from `searchThoughts`.
