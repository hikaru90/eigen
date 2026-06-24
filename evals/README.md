# Eigen Evals

DB-backed evaluation via **`/eval`** (dev only): ingest thoughts, optionally probe retrieval, apply edits, then judge answers.

## Run

```bash
npm run db:migrate && npm run db:rls
npm run eval              # smoke — one question from eval_qa
npm run eval -- --mode all
npm run eval -- --mode qa --qa-id qa_smoke_dinner
npm run eval -- --mode qa --qa-id qa_surgical_vats_phrenic_stapler
npm run eval -- --fresh-corpus   # wipe corpus tenant and re-ingest everything
npm run eval:reset-fixture -- --fixture ec_jonas_silence   # delete one corpus thought so next run re-captures it
```

Dev UI: `/eval` — manage the **Questions & answers** catalog. Use **Run** on a row to execute one question (`mode: qa`), or use the Runs tab for smoke/all. **Reset corpus & start** wipes the shared eval tenant before ingesting. **Stop run** cancels the in-process runner without restarting dev (finishes the current step, then exits).

## Persistent corpus

Each operator has one shared eval brain tenant (`eval-corpus-{operatorUserId}`). By default:

- **Thoughts are kept** across runs (no post-run wipe).
- **Captures are skipped** when a fixture was already ingested with the same `rawText`.
- **Re-capture** happens automatically if fixture text in the catalog changed or the thought was deleted.

Use `--fresh-corpus` (CLI) or **Reset corpus & start** (UI) when you need a clean slate — e.g. after changing fixture text or debugging edit tests that left shared fixtures modified.

### Automatic retrieval-only prune (broken ingest on graded fixtures)

When a **check** entry finds ingest failures (embedding, extraction, entities, graph, ontology) on a fixture that is also listed in **`retrievalRelevant`**, the harness **automatically**:

1. Updates **`eval_qa`** — removes those fixture ids from `retrievalRelevant` only (captures and structural checks unchanged; clears `needleFixtureId` if the needle was pruned).
2. On the **retrieval** step in the same run — grades NDCG without those fixtures and skips the needle-in-top-K check for an ingest-broken needle.

Pure retrieval failures (healthy ingest, bad rank) are **not** auto-pruned. The **needle** (`checks.retrieval.needleFixtureId`) is never auto-pruned or excluded from grading — a needle ingest failure shows up on the **check** step and retrieval still runs (NDCG / needle-in-top-K may fail until ingest is fixed).

If a prior run cleared `retrievalQuery` on a needle-only QA, run `npm run db:migrate` (see `drizzle/0036_eval_qa_restore_jonas_retrieval.sql`) or re-enter retrieval fields in the Q&A editor.

## Model

- **`eval_qa`** — catalog row: captures, question, acceptance, optional retrieval query/grades, optional edit step, tags, **`checks_json`** (structural assertions)
- **`eval_run` / `eval_entry` / `eval_event` / `eval_thought_map`** — run state and results
- **`evals/datasets/corpus.yaml`** — optional `fixtureId` → `rawText` fallback when expanding captures

## Layout

```
evals/
  run.ts                 # CLI (smoke | all)
  datasets/corpus.yaml   # optional fixture text
  harness/
    qa-run.ts            # expand eval_qa → entries (capture → check → …)
    qa-checks.ts         # deterministic graph/entity/ontology/embedding checks
    run-entry.ts         # execute capture / check / retrieval / edit / answer
    capture-fidelity.ts
    judge-acceptance.ts
    retrieval-sweep.ts
    prune-retrieval-relevant.ts  # drop broken-ingest fixtures from retrieval grades only
    synthesis.ts
```

## Per-question flow

Each QA run expands to: **captures** → **check** (deterministic) → optional **retrieval** → optional **edit** → **answer** (LLM judge) → synthesis.

`checks_json` keys: `graph`, `relations`, `entities`, `ontology`, `extraction`, `embedding`, `retrieval`, `learning`. Empty `{}` uses defaults (graph nodes, embedding, active ontology category, enrichment).

## Concern coverage (seeded QAs)

| Concern | Seeded QA(s) |
|--------|----------------|
| Graph working | all (graph.requireThoughtNodes) |
| Thoughts linked | qa_contradiction_remote_work (relations) |
| Entity counts / surfaces | qa_smoke_dinner, qa_haystack_walnut, … |
| Ontology in classification | all (ontology.requireActiveCategories) |
| Ontology extends over time | qa_ontology_growth (profile cursor + guidance) |
| Extraction / enrichment | all (extraction.requireEnriched) |
| Ontology qualitative fit | answer acceptance text per QA |
| Embedding + lexical | all (embedding.requireVector) |
| Recall / NDCG | qa_haystack_walnut, retrieval QAs |
| Needle in haystack | qa_haystack_walnut (needleFixtureId + top-K) |
| Summarize | qa_synthesis_priya_books |
| Learn from user | qa_edit_allergy_update |
| Improve over time | qa_ontology_growth, retrieval learning flags |
| Dense operative detail recall | `qa_surgical_*` (tag `surgical_memory`) — numeric/landmark/device specifics |

## Graph-scale cost benchmark

Operator-owned economics harness (not QA pass/fail). Measures gateway USD and latency vs corpus size.

```bash
npm run graph-scale
npm run graph-scale -- --sizes 50,100,250 --tracks qa
npm run graph-scale -- --sizes 1000 --confirm-spend
```

See [`docs/planning/graph-scale-cost.md`](../docs/planning/graph-scale-cost.md) and `evals/graph-scale/`.
