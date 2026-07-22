# Graph growth cost scaling

How Eigen LLM/gateway spend scales as the knowledge graph grows, and how to measure it with the `graph-scale` benchmark harness.

**Corpus policy:** graph-scale uses **atomic single-thought captures** aligned with Eigenmesh (`evals/graph-scale/datasets/single-thought-corpus.yaml`). It does **not** use [`evals/datasets/corpus.yaml`](../datasets/corpus.yaml) (eval QA fiction with cross-linked entities) or LongMemEval.

## Scaling summary (architecture)

| Surface                     | Per-operation LLM cost vs graph size                        | Primary driver                                                      |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| **Capture / enrich**        | Mostly **flat** (~5–6 chats + embeds per thought)           | Volume of captures, not entity count                                |
| **Q&A / retrieval**         | **Designed flat** (capped ANN pools + 0–1 rerank + compose) | Query volume                                                        |
| **Overnight consolidation** | **Grows with eligible L1 communities** O(C_L1 / B)          | Batched L1 routing summaries (B communities per chat + embed batch) |
| **GTD project prompts**     | **Grows with project count** O(P)                           | Reconcile, assignment, audit catalogs                               |

Precomputed link tables (`community_bundle`, `entity_top_thoughts`, `thought_neighbor`) keep query-time retrieval from loading unbounded graph context. See [`ingest-retrieval-timing.md`](ingest-retrieval-timing.md) and [`../repo-map/retrieval.md`](../repo-map/retrieval.md).

### Rough lifetime cost model

```
lifetime_usd ≈
  N_captures × ~$0.003–0.006 per capture (model-dependent)
+ ceil(C_eligible_L1 / B) × batch_cost (chat + embed batch; B≈8, budgeted per night)
+ N_qa × ~$0.004–0.008 per answer
+ P_projects × occasional O(P) reconcile/audit calls
```

L2/L0 structural communities remain for hierarchy/bundles but do **not** receive LLM summaries. See [`community-summary-scaling.md`](community-summary-scaling.md).

Fractional **Eigen credits** in Activity or admin spend totals come from summing per-call USD × 1000, not from LLM token counts. Wallet debits are always whole credits.

## Benchmark harness

Operator-owned script (not `/eval` QA pass/fail). Reuses eval RLS context, real capture/enrich, and `activity_call_log` cost aggregation.

### Location

```
evals/graph-scale/
  datasets/single-thought-corpus.yaml  # Atomic capture fixtures (Eigenmesh-shaped)
  load-corpus.ts                       # Corpus loader
  run.ts                               # CLI entry
  cli.ts                               # Argument parsing
  seed-corpus-runner.ts                # Bulk ingest N thoughts
  seed-corpus.ts                       # Text builder + overflow captures
  measure-capture.ts                   # Track A — probe capture
  measure-qa.ts                        # Track B — fixed Q&A set
  measure-consolidation.ts             # Track C — overnight consolidation
  graph-metrics.ts                     # thoughts / entities / edges / communities / projects
  aggregate-cost.ts                    # USD + credits from activity_call_log by groupId
  progress-report.ts                   # JSONL progress log (one line per step)
  report.ts                            # Final JSON + CSV output
```

### Run

```bash
npm run graph-scale
```

Defaults: corpus sizes **50, 100, 250**; all three tracks; live progress under `evals/graph-scale/runs/report-<timestamp>.jsonl` (one JSON object per line, appended as each step completes); final summary under `.json` (+ `.csv`).

**Watch progress while a run is in flight:**

```bash
tail -f evals/graph-scale/runs/report-<timestamp>.jsonl
```

Each line includes an `at` timestamp. During the run you mostly see compact **`progress`** lines:

```json
{ "at": "…", "step": "progress", "pct": 37, "etaSec": 840, "label": "N=50 seed enrich" }
```

Milestones only: `run_started`, `point_completed` (per corpus size), `run_finished` or `run_failed`. Final JSON/CSV written at the end.

**Terminal output** is the same `% · ETA · label` line (updated in place when stderr is a TTY).

```bash
# Q&A flat-curve check only (cheapest)
npm run graph-scale -- --sizes 50,100,250 --tracks qa

# Custom output path
npm run graph-scale -- --output evals/graph-scale/runs/my-run.json

# Large sweep (requires explicit spend ack)
npm run graph-scale -- --sizes 500,1000 --confirm-spend
```

**Requirements:** running Postgres + migrated schema + platform LLM env (`LLM_BASE_URL`, service keys, etc.). The harness credits the `graph-scale-runner` operator wallet automatically (same pattern as `measure:ingest`).

### Tracks

| Track                 | Question answered                                              | Expected curve                                      |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| **A — capture**       | Does **one more atomic capture** cost more as the graph grows? | Flat USD per probe capture ± noise                  |
| **B — qa**            | Does retrieval/Q&A stay flat?                                  | Flat USD per fixed query set                        |
| **C — consolidation** | What does overnight cost at this graph size?                   | ~linear in **eligible L1** communities / batch size |

Each size **N** uses a fresh harness tenant `graph-scale-corpus-<runId>-<N>` with **N** standalone captures from the single-thought corpus (parametric overflow when N > 60).

**Capture probe (track A):** one atomic work note — `Send the revised invoice to accounting before Friday close.` — not eval fiction with named entities and temporal chains.

**Q&A set (track B):** five theme queries (errands, appointments, home, work, health) aligned with corpus themes — not eval character questions (`Who is Marcus?`).

### Report shape

```json
{
  "nThoughts": 250,
  "graph": { "thoughts": 250, "entities": 180, "edges": 920, "communities": 12, "projects": 2 },
  "captureProbe": { "usd": "0.004800", "credits": 4.8, "wallMs": 11200, "phases": {} },
  "qaFixedSet": { "usdTotal": "0.031000", "usdPerQuery": "0.006200", "p95Ms": 4200 },
  "consolidation": { "usd": "0.142000", "communitiesSummarized": 12, "wallMs": 95000 }
}
```

Validate spend on **`/admin/spend`** with **Including harness** enabled (`graph-scale-runner` operator, harness corpus tenants).

### Unit tests

```bash
npm run test:unit -- evals/graph-scale
```

## Interpreting results

- **Flat capture/Q&A curves** confirm capped retrieval and enrich prompts are working as designed on volume-grown graphs.
- **Upward capture drift** at large N may indicate relation extraction or community refresh firing more often — check `captureProbe.phases`; with the single-thought corpus this should be **much lower** than eval-fiction seeding.
- **Consolidation slope** is the main graph-structure cost risk; plot `consolidation.usd` vs `graph.communities`.
- **Seed wall time** (`seedWallMs`) grows ~linearly with N (expected); it is not per-query cost.

## Related tooling

| Tool                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `npm run measure:ingest`   | Single capture phase breakdown                          |
| `npm run eval:longmemeval` | Large realistic corpus for QA accuracy (not economics)  |
| `/eval` UI                 | QA pass/fail on eval corpus (not graph-scale economics) |
| `/activity`                | Per-call gateway cost for manual inspection             |
| `/admin/spend`             | Deployment spend with harness filter                    |
