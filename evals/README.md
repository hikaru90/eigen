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
   each generated answer on the **golden baseline 4-axis rubric**:

   | Axis | Weight | What it measures |
   |------|--------|-----------------|
   | accuracy | 40% | Every factual claim is grounded in the retrieved thoughts and is correct |
   | calibration | 25% | Confidence is appropriately expressed; the system knows what it doesn't know; stale facts are flagged; contradictions are surfaced |
   | completeness | 20% | All relevant stored information is surfaced; nothing important is omitted |
   | tone | 15% | Response is framed usefully — not intrusive, clinical, or preachy |

   Weighted final score = `accuracy×0.40 + calibration×0.25 + completeness×0.20 + tone×0.15`

   Score scale (1–5):
   - **5 Excellent** — exceeds expectation, handles edge cases gracefully
   - **4 Pass+** — solid pass, minor gaps only
   - **3 Pass** — meets the expected behaviour
   - **2 Partial** — correct intent but meaningfully incomplete or miscalibrated
   - **1 Fail** — wrong, confabulated, misleading, or missing entirely

## Capability dimensions

Answer cases are tagged with a dimension from the golden baseline eval framework.
Each dimension has a minimum weighted pass threshold:

| Dimension | Tag | Min score |
|-----------|-----|-----------|
| Faithful Recall | `faithful_recall` | 4.0 |
| Temporal Reasoning | `temporal_reasoning` | 3.5 |
| Synthesis & Connection | `synthesis` | 3.2 |
| Personalization | `personalization` | 3.2 |
| Contextual Relevance | `contextual_relevance` | 3.5 |
| Graceful Uncertainty | `graceful_uncertainty` | 4.0 |
| Contradiction Detection | `contradiction_detection` | 3.5 |
| Proactive Recall | `proactive_recall` | 2.75 |
| Privacy & Scoping | `privacy_scoping` | 4.3 |
| Memory Decay & Staleness | `memory_decay` | 3.5 |
| General (untagged) | `default` | 3.0 |

## Layout

```
evals/
  datasets/
    retrieval/
      corpus.yaml            # ~100 thoughts in 10 named-entity clusters
      relations.yaml         # ~60 graph edges (required for graph signal)
      queries.yaml           # 30 queries: semantic_paraphrase / entity_relation / hybrid
      embeddings.cache.json  # gitignored; populated on first seed
    answer/
      qa-cases.yaml          # 48 cases across 10 capability dimensions
    agent/
      thoughts-10.yaml       # 10 thoughts for agent-ingest eval
      probes.yaml            # retrieval + QA probes for agent eval
  golden/
    dataset.yaml             # 10 human-labeled golden thoughts (entity/relation ground truth)
    README.md                # Golden dataset documentation
  harness/
    seed-fixtures.ts         # idempotent DB seed for retrieval fixtures (respects created_at)
    retrieval-eval.ts        # weight-sweep ablation runner
    answer-eval.ts           # composeAnswer + 4-axis judge runner
    agent-ingest-eval.ts     # end-to-end ingest + retrieval + answer eval
    judge.ts                 # LLM-as-judge wrapper (4-axis rubric, temp 0, structured JSON)
    judge-rubric.ts          # dimension → pass threshold map
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
npm run eval:answer       # composeAnswer + 4-axis judge + report
npm run eval:all          # all of the above
```

Reports land in `evals/reports/`. To promote a successful run to a
checked-in baseline:

```bash
npm run eval:baseline retrieval   # copies retrieval-latest.json -> baselines/retrieval.json
npm run eval:baseline answer
npm run eval:baseline both
```

## Corpus clusters

| Cluster | Topics | Key entities | Eval dimensions |
|---------|--------|-------------|-----------------|
| A | Sourdough / cooking | Marcus, Tartine | D1, D5 |
| B | Eigen engineering | Sarah | D1, D3 |
| C | Strength training | Diego | D1, D3 |
| D | Climbing / outdoors | Tom | D1, D3 |
| E | Books and ideas | Priya | D1, D3 |
| F | Finance and admin | — | D1, D6 |
| G | Temporal sequence | — | **D2 (temporal reasoning)** |
| H | Contradiction pairs | — | **D7 (contradiction detection)** |
| I | Staleness / decay | — | **D10 (memory decay)** |
| J | Personalization signals | — | **D4 (personalization)** |

## What compose-answer now does

Beyond basic RAG, `composeAnswer` adds:

- **Timestamp surfacing** — each retrieved thought's `created_at` date is shown in the
  prompt so the LLM can reason about recency and sequence.
- **Staleness annotation** — thoughts older than 6 months are flagged with a `⚠ STALE`
  marker and a hard rule instructs the LLM to present them with explicit date context
  rather than asserting them as currently true.
- **Contradiction detection** — a post-retrieval pass groups thoughts by subject and
  detects opposing polarity, location changes, and other conflict signals. Detected
  pairs are injected as a `Detected potential contradictions` section in the prompt,
  which the LLM must surface rather than silently picking one side.

These features feed the D2, D7, and D10 eval dimensions directly.

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

- **New retrieval queries**: add to `queries.yaml` with graded relevance labels.
- **New answer cases**: add to `qa-cases.yaml` with `id`, `question`, `expected_facts`,
  and a `dimension` tag (see dimension table above).
- **New corpus thoughts**: add to `corpus.yaml`. Add an optional `created_at` (ISO-8601)
  field to set a deterministic DB timestamp for temporal eval cases.
- **New dimension thresholds**: edit `evals/harness/judge-rubric.ts`.
