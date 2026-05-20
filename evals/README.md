# Eigen Evals

DB-backed evaluation via **`/eval`** (dev only): ingest thoughts, optionally probe retrieval, apply edits, then judge answers.

## Run

```bash
npm run db:migrate && npm run db:rls
npm run eval              # smoke — one question from eval_qa
npm run eval -- --mode all
npm run eval -- --mode qa --qa-id qa_smoke_dinner
npm run eval -- --mode qa --qa-id qa_surgical_vats_phrenic_stapler
```

Dev UI: `/eval` — manage the **Questions & answers** catalog. Use **Run** on a row to execute one question (`mode: qa`), or use the Runs tab for smoke/all.

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
