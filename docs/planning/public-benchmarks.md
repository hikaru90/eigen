# Public benchmarks: PersonaMem-v2 and MemoryAgentBench Conflict Resolution

Status: **approved — decisions D1–D7 confirmed by the operator** (2026-10-25). Written so that an implementation
agent can pick up any phase cold. Read §0–§2 first, then only the phase you were given.

| Claim we want to make | Benchmark | Headline metric |
| --- | --- | --- |
| "Eigen knows you" | PersonaMem-v2 (text, 32k histories) | 4-option MCQ accuracy, broken down by `pref_type` |
| "Eigen is always up to date" | MemoryAgentBench → `Conflict_Resolution` (FactConsolidation SH + MH) | Substring exact match (SubEM), SH and MH reported separately |

Both run through the **real product path**: `queueCapture` → enrich → `composeAnswer`. No
benchmark-specific prompts, branches or heuristics inside `src/`. Anything that only exists to talk
to a benchmark lives under `evals/`.

---

## 0. Ground rules for implementation agents

These come from `AGENTS.md`; the ones below are the ones most likely to be violated here.

1. **Template to copy:** `evals/longmemeval/` (cli → load → ingest per tenant → `composeAnswer` →
   JSONL → score). Read all eight files before starting. Do not invent a new architecture.
2. **No fallbacks / no implicit defaults.** Required config (data dir, models, concurrency, output
   dir) comes from explicit CLI flags or env and **fails loud** when missing. Do not copy the
   `|| 'openai/gpt-4o-mini'` style defaults from `evals/longmemeval/ensure-operator.ts` — Phase 0
   removes them.
3. **No string heuristics for meaning in `src/`.** Grading code in `evals/` may do what the
   published protocol does (e.g. SQuAD answer normalization for SubEM) — that is benchmark
   fidelity, not app semantics. Letter/answer extraction from model output uses a JSON-schema LLM
   call, not regex.
4. **Do not patch the product for a benchmark.** If a category scores badly (e.g. `ask_to_forget`),
   report it. Product fixes are separate, generalized work agreed with the operator.
5. **TDD:** write the unit specs listed in each phase first, watch them fail, then implement.
   Run `npm run test:unit` (only the new specs while iterating; full suite before handing back),
   `npm run lint`, `npm run check`.
6. **Do not run paid benchmark runs.** Agents may run `--dry-run` (no DB, no LLM). Smoke / pilot /
   full runs spend OpenRouter money and are started by the operator (§5).
7. **Do not touch unrelated working-tree changes** (at plan time: `capture-kept.svelte`,
   `thought-sheet.svelte`, `src/lib/thought/*`, `.pi/`). **Do not commit.** The coordinating
   session reviews and commits.
8. Embeddings never appear in outputs/logs (`docs/planning/embeddings-db-only-boundary.md`).
   `composeAnswer().retrieved` items are safe (no vectors) — keep it that way, write only
   `id`, `normalizedText`, `score`, `createdAt`.

---

## 1. What already exists (verified 2026-10-25, HEAD `193e9cef`)

- `evals/longmemeval/run.ts` — per question: reset tenant `longmemeval-corpus-<id>` via
  `deleteEvalUserRow`/`insertEvalUserRow`, `queueCapture(userId, text, { source: 'eval', skipWorker: true, capturedAt })`
  inside `withEvalDb(userId, fn, { billingUserId })`, then `processCaptureEnrichQueue`,
  `waitForThoughtEnrichmentComplete`, then `composeAnswer({ userId, question, referenceTime })`.
- **Correction (found in Phase 0):** BYOK was removed in `ecb31d6d` (2026-10-24). Every LLM call
  goes through OpenRouter on `SERVICE_API_KEY_OPENROUTER` with models pinned in
  `src/lib/server/billing/platform-llm.ts` (`PLATFORM_CHAT_MODEL` = deepseek-v4.1-flash,
  `PLATFORM_EMBEDDING_MODEL` = qwen3-embedding-8b) and debits the billing user's platform-credit
  wallet. Harness tenants are funded via id prefixes in `src/lib/server/auth/harness-billing.ts`;
  public benchmarks use operator `public-bench-runner` and tenants `public-bench-*`.
- Phase 0 (done) added `evals/public-bench/` — `ensurePublicBenchOperator`, `ingestTenant`
  (waves of `enrichConcurrency`: queue → drain → wait, so facts arrive in order), `seededShuffle`,
  `run-output`, `aggregateRunCost` — and moved LongMemEval onto it.
- `evals/harness/concurrency.ts` → `mapWithConcurrency` (bounded parallel map).
- `src/lib/server/capture/enrich-queue-drain.ts` → per-tenant enrich drain with
  `options.concurrency` (pass it explicitly).
- `src/lib/server/activity/trace-cost.ts` → `aggregateActivityCostByGroupId` /
  `aggregateActivityCostFromRows` for USD totals from `activity_call_log`.
- `composeAnswer` (`src/lib/server/qa/compose-answer.ts:503`) returns
  `{ answer, citations, retrieved, conflicts, retrievalPath }`. Citation tokens are stripped with
  `formatComposedAnswerForUser`.
- `vitest.config.ts` includes `evals/harness/**` and `evals/graph-scale/**` specs only — new dirs
  must be added to `include`.
- `evals/reports/` is gitignored — benchmark outputs go there.
- Measured cost (graph-scale, 2026-07-02): ~$0.0007 USD and ~25 s wall per atomic capture
  (capture + enrich, gpt-4o-mini class). PersonaMem user turns are longer; budget $0.001–0.002.

---

## 2. Decisions (approved by the operator 2026-10-25)

| ID | Decision | Proposal | Why |
| --- | --- | --- | --- |
| D1 | Models — **⚠ revision pending:** the gpt-4o-mini setup below is not runnable since BYOK removal (§1); operator to choose shipped models vs. an eval-only override | One chat model for the whole pipeline **and** the benchmark answer/extract step, passed explicitly: `LLM_MODEL_CHAT=openai/gpt-4o-mini`, `LLM_MODEL_EMBEDDING=openai/text-embedding-3-small`, `--answer-model openai/gpt-4o-mini`. | MemoryAgentBench's published RAG/memory baselines (Mem0, Zep, HippoRAG-v2, BM25 …) use gpt-4o-mini, so CR numbers are directly comparable. One model across both keeps the story simple. A second run with a frontier model is optional later. |
| D2 | PersonaMem persona system message | **Exclude.** Each 32k history starts with a `system` message holding the persona's demographics (no preferences). Eigen learns from what the user says, not from a profile dump. | Harder and more honest; report it in the summary. |
| D3 | PersonaMem capture granularity | One capture per **user** turn; assistant turns and the system message are not captured. `capturedAt = 2025-01-01T00:00Z + turnIndex minutes` (histories have no dates; order matters for `updated` preferences). | Mirrors LongMemEval `user-turn` mode, which is the adapter's default. |
| D4 | MAB fact capture | One capture per fact sentence, **serial number stripped**, `capturedAt = 2025-01-01T00:00Z + serial minutes`. Recency is conveyed only by time, like a real user. | The official long-context prompt tells the model "larger serial = newer". We deliberately give Eigen less: it must know newer from older by itself. Documented as a protocol deviation (conservative). |
| D5 | MAB context lengths | Pilot and headline on **6k** (455 facts) and **32k** (2,310 facts). 64k/262k out of scope for v1 (4,580 / 18,332 captures). | Third-party comparisons publish sh/mh × 6k/32k. |
| D6 | Enrich concurrency within one tenant | `--enrich-concurrency 1` for both benchmarks (order-faithful). Parallelism comes from running tenants (personas) side by side: `--tenant-concurrency`. | Supersession/contradiction relations are computed at enrich time against existing thoughts; racing enrich is not how a real user's memory grows. Record the value in every summary. |
| D7 | Consolidation (nightly sleep job) | Not run in v1. | Benchmarks measure capture-time behaviour; add `--consolidate` later if wanted. |

---

## 3. Phase 0 — shared public-bench harness (small refactor)

**Goal:** both new benchmarks and LongMemEval share one operator setup and one tenant-ingest
routine, instead of three copies.

Create `evals/public-bench/`:

- `ensure-operator.ts` — `ensurePublicBenchOperator({ operatorUserId, displayName })`.
  Extracted from `evals/longmemeval/ensure-operator.ts`. Reads `OPENROUTER_API_KEY`,
  `OPENROUTER_BASE_URL`, `LLM_MODEL_CHAT`, `LLM_MODEL_EMBEDDING` from env and **throws a named
  error listing every missing variable** (no defaults). Returns `{ modelChat, modelEmbedding }`.
- `ingest-tenant.ts` — `ingestTenant({ tenantUserId, billingUserId, items, enrichConcurrency, reset })`
  where `items: { rawText: string; capturedAt: Date }[]`. Body = the capture/enrich/wait block of
  `evals/longmemeval/run.ts:runInstance`. Queues in order, drains with
  `{ concurrency: enrichConcurrency }`, waits for enrichment, returns thought ids. `reset: false`
  asserts the tenant already holds exactly `items.length` thoughts and skips ingest (fails loud
  otherwise) — this is how `--skip-ingest` reuses a corpus.
- `seeded.ts` — `seededShuffle<T>(items, seed: string)` (sha256-seeded PRNG + Fisher–Yates) and
  `seededSample`. Pure, deterministic across processes (do **not** mirror Python `hash()`, which is
  salted per process).
- `run-output.ts` — run dir `evals/reports/public/<bench>/<runId>/`, `appendJsonl`, `readJsonlIds`
  (for `--resume`), `writeSummary(summary)` → `summary.json` + `summary.md`.
- `cost.ts` — USD totals for a set of tenant ids over the run window from `activity_call_log`
  using `$lib/server/activity/trace-cost`. Check which column holds the tenant vs. the billing
  user before writing the query.

Then switch `evals/longmemeval/{run,ensure-operator}.ts` to use these (delete the duplicated code;
LongMemEval now also requires explicit model env vars). Add `'evals/public-bench/**/*.{test,spec}.{js,ts}'`,
`'evals/personamem/**/…'`, `'evals/memoryagentbench/**/…'`, `'evals/longmemeval/**/…'` to
`vitest.config.ts` `include`. Add `evals/.data/` to `.gitignore`.

**Tests first** (`evals/public-bench/*.spec.ts`):
- `seededShuffle` is deterministic for the same seed, differs across seeds, is a permutation.
- `ensurePublicBenchOperator` env validation: missing vars → error names each one (test the
  validation function in isolation; do not hit the DB).
- `readJsonlIds` / resume skips existing ids; tolerates a trailing newline; throws on a corrupt line.
- `ingestTenant` with `reset: false` and a count mismatch throws (inject the count function).

**Done when:** specs green, `npm run test:unit`, `lint`, `check` green, and
`npm run eval:longmemeval -- --help` still works. Risk: **normal**.

---

## 4. Phase 1 — PersonaMem-v2 ("it knows you")

### 4.1 Dataset facts (verified by downloading, 2026-10-25)

- HF `bowen-upenn/PersonaMem-v2` (CC-BY-4.0). Code: github.com/bowen-upenn/PersonaMem-v2
  (`inference.py` is the official evaluator). A v3 exists; we run **v2** because the published
  baselines are v2.
- `benchmark/text/benchmark.csv` (42 MB): **5,000 rows, 200 personas, 6–42 queries per persona**.
  Columns used: `persona_id`, `chat_history_32k_link` (e.g. `data/chat_history_32k/chat_history_250913_163134_persona521.json`),
  `user_query`, `correct_answer`, `incorrect_answers`, `preference`, `pref_type`, `who`, `updated`,
  `prev_pref`, `conversation_scenario`, `topic_query`, `distance_from_related_snippet_to_query_32k`.
- Encodings: `user_query` is a **Python dict repr** in all 5,000 rows
  (`{'role': 'user', 'content': "…"}`) — official code parses it with `ast.literal_eval`.
  `incorrect_answers` is a JSON list of exactly 3 strings. `correct_answer` never appears in it.
- `pref_type` mix: ask_to_forget 1048 · neutral 858 · anti_stereotypical 855 · therapy 627 ·
  health_and_medical 568 · stereotypical 533 · sensitive_info 511. `updated=True` on 1,047 rows.
- Chat history JSON: `{ metadata: { total_messages, final_token_count, persona_id, input_filename }, chat_history: [{ role, content }] }`.
  Persona 0: 237 messages = 1 system + 128 user + 108 assistant, ~32k tokens; user turns ≈ 29k chars.
- Official protocol (`inference.py`, `evaluate_row` + `create_mcq_options`): history + user query
  (with a sentence appended asking to recall preferences) + an MCQ instruction listing 4 shuffled
  options A–D; model ends with `Final Answer: <letter>`; accuracy = letter maps to
  `correct_answer`. Published: frontier LLMs 37–48% (long context), their agentic memory 55%.
  Random = 25%.

### 4.2 Mapping to Eigen

```
benchmark.csv row ──► prepare.py ──► personamem.benchmark.jsonl (clean, typed)
                                           │
per persona (tenant  personamem-v2-p<id>): │
  chat_history_32k user turns ─► ingestTenant (D2, D3, D6)
  for each query of that persona:
     composeAnswer({ userId: tenant, question: query.content })     ← Eigen product path, options NOT shown
     choose-option LLM call (JSON schema)                          ← benchmark adapter
        input: query, Eigen's retrieved memories (normalizedText, top-K as returned),
               4 options shuffled by seededShuffle(`${persona_id}:${query.content}`)
        output: { "letter": "A"|"B"|"C"|"D" }
     correct = options[letter] === correct_answer
```

Why this shape: options contain *other* people's preferences ("Since you enjoy vegetarian
recipes…"), so they must not reach Eigen's retrieval. Eigen retrieves from the bare query, exactly
as a user would ask; the chooser then sees only what Eigen surfaced. This matches how the paper
evaluates memory systems (memory + query + options). Eigen's own free-text answer is stored for
qualitative review but not scored in v1.

Two variants, both in every run (same options, same chooser):
- `eigen` — chooser gets Eigen's retrieved memories.
- `no-memory` — chooser gets no memories. This is the **lift baseline**: it shows how much of the
  score comes from Eigen vs. from distractors being guessable. Publish both.

### 4.3 Files

```
evals/personamem/
  prepare.py            # python3 -I, stdlib only: csv + ast + json → JSONL; validates every row
  types.ts              # zod schemas for the prepared JSONL + output rows
  load-dataset.ts       # read + zod-validate prepared JSONL; group by persona; load history file
  history-to-captures.ts# D2/D3 mapping → { rawText, capturedAt }[]
  mcq.ts                # buildOptions(row) → { options: {A..D}, correctLetter }; chooser prompt builder
  choose-option.ts      # one LLM call, JSON schema { letter }, via the operator's configured client
  score.ts              # aggregate: overall, per pref_type, per updated, per who, per distance bucket
  cli.ts                # flags below
  run.ts                # orchestration (Phase 0 helpers)
```

`prepare.py` output row: `{ personaId, historyPath (absolute), query, correctAnswer, incorrectAnswers[3], prefType, who, updated, prevPref, scenario, topicQuery, distance32k, questionId }`
with `questionId = "p<personaId>-<sha256(query)[:12]>"`. It refuses (non-zero exit, message) on any
row it cannot parse — no skipping. `prepare.py --print-history-urls` prints the HF download URL of
each distinct `chat_history_32k_link` (200 files) so the operator fetches only those; `prepare.py`
without that flag fails naming any history file that is missing locally.

The chooser call: use the same LLM client / model plumbing Eigen uses for structured JSON calls
(find the existing helper used by e.g. `classifyQueryIntent`; do not hand-roll fetch). Model =
`--answer-model`. Log its USD under the operator like every other call.

### 4.4 CLI

```
npm run eval:personamem -- \
  --data-dir evals/.data/personamem-v2          # required; contains prepared JSONL + data/chat_history_32k
  --personas 20 --seed pilot-1                  # or --persona-ids 0,5,12  or --all   (exactly one required)
  --answer-model openai/gpt-4o-mini             # required
  --tenant-concurrency 4 --enrich-concurrency 1 # required
  [--run-id NAME] [--resume] [--skip-ingest] [--limit-queries N] [--dry-run]
```

`--dry-run`: loads + validates data, selects personas, builds capture items and options, prints
personas / captures / queries / estimated USD (captures × $0.0015 + queries × $0.008) and exits
without touching DB or LLM. Add `"eval:personamem"` to `package.json` mirroring `eval:longmemeval`.

### 4.5 Outputs

`evals/reports/public/personamem-v2/<runId>/answers.jsonl` — one row per (question, variant):
`{ questionId, personaId, variant, prefType, updated, who, letter, correctLetter, correct, eigenAnswer, retrieved: [{id, normalizedText, score}], usd, ms }`
(`eigenAnswer`/`retrieved` only on the `eigen` variant).

`summary.json` / `summary.md`: run config (all flags, D-decisions in effect, models, git sha),
counts, accuracy for each variant overall and per `pref_type` / `updated` / `who` / distance bucket
(0–8k, 8–16k, 16–24k, 24k+), lift (`eigen − no-memory`), invalid-letter count (must be 0; an
invalid schema response fails the call per the retry policy), total USD (ingest vs answer), wall
time. Include the published reference numbers (37–48% long-context frontier, 55% paper agentic
memory, 25% random) as context lines, clearly labelled as from the paper.

### 4.6 Tests first (`evals/personamem/*.spec.ts`, fixtures under `evals/personamem/fixtures/`)

Make a tiny fixture: 2 personas, 3 rows each, plus 2 truncated history files (10 messages incl.
one system message) — hand-written, not copied from the dataset.

- `prepare.py`: run it on a fixture CSV from the spec via `spawnSync('python3', ['-I', …])`; asserts
  Python-repr `user_query` is parsed, 3 incorrect answers, refuses a malformed row.
- `load-dataset`: zod rejects a row with 2 incorrect answers; groups by persona; missing history file → error naming the path.
- `history-to-captures`: drops system + assistant turns; order preserved; `capturedAt` strictly
  increasing by one minute from the fixed epoch; empty content turn → error.
- `mcq`: options are a permutation of correct + 3 incorrect; same seed → same letters across runs;
  `correctLetter` maps back to `correctAnswer`.
- `score`: hand-computed fixture of 6 answer rows → exact overall/per-pref_type/lift numbers.
- `cli`: each required flag missing → usage error naming it; `--personas` and `--all` together → error.
- `choose-option`: with an injected fake LLM, returns the letter; a response outside A–D → throws.

**Done when:** specs green; full `test:unit`, `lint`, `check` green; `--dry-run --personas 20 --seed pilot-1`
prints a plan on the real prepared data (operator downloads it, §5.1). Risk: **high** (it is
evals-only code, but it is the evidence for a public claim).

---

## 5. Running (operator-owned)

### 5.1 Data download (once, ~80 MB, into the gitignored `evals/.data/`)

```bash
mkdir -p evals/.data/personamem-v2/benchmark/text evals/.data/personamem-v2/data
curl -L -o evals/.data/personamem-v2/benchmark/text/benchmark.csv https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2/resolve/main/benchmark/text/benchmark.csv
# only the 200 personas referenced by benchmark.csv (~36 MB): the agent ships a fetch list via prepare.py --print-history-urls
python3 -I evals/personamem/prepare.py --data-dir evals/.data/personamem-v2
```

MemoryAgentBench CR: `curl -L -o evals/.data/memoryagentbench/Conflict_Resolution.parquet https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/resolve/main/data/Conflict_Resolution-00000-of-00001.parquet` (1.5 MB).

### 5.2 Run ladder (each step must be green and reviewed before the next)

| Step | PersonaMem-v2 | Est. USD | Est. wall |
| --- | --- | --- | --- |
| dry run | `--dry-run --personas 20 --seed pilot-1` | 0 | seconds |
| smoke | `--persona-ids 0 --limit-queries 5` | < $0.50 | ~25–55 min (128 captures serial at 10–25 s) |
| pilot | `--personas 20 --seed pilot-1 --tenant-concurrency 4` (~500 queries) | ~$5–10 | ~2–4.5 h |
| full | `--all --tenant-concurrency 8` (5,000 queries) | ~$50–80 | ~10–22 h |

Wall time is dominated by serial enrich inside each persona (D6). The smoke run measures the real
per-capture time; re-estimate pilot/full from it before starting them.

Prereqs: `npm run db:migrate && npm run db:rls`, `OPENROUTER_API_KEY`, `LLM_MODEL_CHAT`,
`LLM_MODEL_EMBEDDING` in `.env`. Re-answering with another `--answer-model` uses `--skip-ingest`.

After the pilot: read `summary.md`, look at the 20 worst `pref_type` rows by hand, and decide
whether we go to full or first fix a *generalized* product issue (separate task).

### 5.3 Publishing

Only full runs are publishable. A public number always ships with: benchmark + split + version,
models, D-decisions (esp. D2/D4 deviations), the `no-memory` lift, n, USD, and git sha. Never
publish a subset number as if it were the full benchmark.

---

## 6. Phase 2 — MemoryAgentBench Conflict Resolution ("always up to date")

Start only after Phase 1's pilot has run (shared harness proven).

### 6.1 Dataset facts (verified by downloading, 2026-10-25)

- HF `ai-hyz/MemoryAgentBench` (MIT), split `Conflict_Resolution`, file
  `data/Conflict_Resolution-00000-of-00001.parquet` (1.5 MB), **8 rows**: `metadata.source` ∈
  `factconsolidation_{sh,mh}_{6k,32k,64k,262k}`. Code: github.com/HUST-AI-HYZ/MemoryAgentBench.
- Each row: `context` = `"Here is a list of facts:\n0. <fact>\n1. <fact>…"` (6k: 455 facts,
  32k: 2,310), `questions` (100 strings), `answers` (100 lists of acceptable strings),
  `metadata.qa_pair_ids` (e.g. `factconsolidation_sh_6k_no0`).
- **SH and MH rows of the same length share an identical `context`** → ingest once per length,
  answer 200 questions (100 SH + 100 MH) against the same tenant.
- Facts are counterfactual edits: e.g. `59. pesäpallo was created in the country of Finland.` then
  `261. pesäpallo was created in the country of Philippines.` — the newer one is correct.
  SH: "Which sport is goaltender associated with?" → `pesäpallo`. MH chains 2–4 hops
  ("country of citizenship of the spouse of the author of Our Mutual Friend?" → `Belgium`).
  Answers often contradict world knowledge on purpose.
- Metric (`utils/eval_other_utils.py`): `calculate_metrics` → `substring_exact_match` =
  `normalize_answer(gt) in normalize_answer(pred)`, max over ground truths; `normalize_answer` is
  the SQuAD normalizer (lowercase, strip punctuation, drop articles a/an/the, collapse whitespace).
  `exact_match` is reported alongside.
- Published (gpt-4o-mini backbone): SH — HippoRAG-v2 54%, BM25 48%, Mem0 18%, Zep 7%; MH ≤ 7% for
  all 22 systems evaluated in a follow-up study. Confirm exact numbers from the paper table before
  quoting them publicly.

### 6.2 Mapping to Eigen

```
parquet ─► prepare.py (pyarrow, in a scratch venv) ─► mab-cr.jsonl { source, length, hop, facts[{serial,text}], qas[{id,question,answers[]}] }
per length L ∈ {6k, 32k}:  tenant mab-cr-<L>
  facts ─► ingestTenant (D4: no serial in text, capturedAt = epoch + serial min; D6)
  for each of the 200 questions (sh + mh):
     composeAnswer({ userId: tenant, question })            ← product path, question verbatim
     extract-answer LLM call (JSON schema { answer: string })
        "the single value the response commits to as current; empty string if it does not commit"
     score: SubEM + EM on extracted answer (headline); SubEM on raw answer (reported, not headline)
```

The extract step exists because substring matching on a verbose answer that mentions both the
old and the new value would count as correct. Headline uses the extracted, committed answer.

### 6.3 Files, CLI, tests

```
evals/memoryagentbench/
  prepare.py  types.ts  load-dataset.ts  facts-to-captures.ts
  normalize.ts            # exact port of SQuAD normalize_answer + EM/SubEM, max over ground truths
  extract-answer.ts  score.ts  cli.ts  run.ts
```

`npm run eval:mab-cr -- --data-dir … --lengths 6k,32k --answer-model … --enrich-concurrency 1 [--hops sh,mh] [--limit-questions N] [--skip-ingest] [--resume] [--dry-run]`

Tests first:
- `normalize.spec.ts`: test vectors computed once with the official Python function and pasted as
  literals (articles, punctuation, unicode like `pesäpallo`, whitespace); SubEM max over ground truths.
- `facts-to-captures.spec.ts`: parses `N. text` lines, strips serials, monotonic `capturedAt`,
  refuses a non-contiguous serial or a header-less context.
- `load-dataset.spec.ts`: SH/MH of one length grouped onto one shared tenant; mismatched contexts → error.
- `score.spec.ts`: hand-computed fixture → per-hop SubEM/EM, raw-vs-extracted columns.
- `cli.spec.ts`, `extract-answer.spec.ts` (fake LLM; non-string → throws).

Run ladder: dry run → smoke (`--lengths 6k --limit-questions 10`, ~455 captures, ≈ $0.50, ~1–3 h
serial enrich) → headline (6k + 32k, 400 questions, ≈ $5–8, ~1 day of serial enrich for 32k; run
6k first). Risk: **high**.

Expected weak spots to report, not patch: MH chains (everyone fails), counterfactual facts vs. the
answer model's world knowledge, and whether enrich-time contradiction relations
(`src/lib/server/memory/relation-extraction.ts`, surfaced as `composeAnswer().conflicts`) actually
fire for "X was created in country A" → "… country B".

---

## 7. Handoff briefs

Each brief is self-contained; give the implementing agent this file path plus one brief.

- **Phase 0 brief:** "Implement §3 of `docs/planning/public-benchmarks.md`. Read §0–§1 first. Tests
  first. Refactor LongMemEval onto the shared helpers. Do not commit. Report: files changed, test
  output, anything in §1 that turned out wrong."
- **Phase 1 brief:** "Implement §4 of `docs/planning/public-benchmarks.md` (PersonaMem-v2) on top
  of the Phase 0 helpers. Read §0–§2 first; decisions D1–D3, D6 are fixed. Tests first. You may run
  `--dry-run` only. Do not commit. Report: files changed, test output, dry-run output, open
  questions."
- **Phase 2 brief:** same for §6 (MemoryAgentBench CR), decisions D1, D4–D6.

## 8. Requirement record

- **REQ-PB-1 (PersonaMem-v2):** In scope — text split, 32k histories, MCQ accuracy, `eigen` and
  `no-memory` variants. Out of scope — multimodal split, 128k histories, generative/open-ended
  judging, training splits, product changes.
- **REQ-PB-2 (MAB CR):** In scope — FactConsolidation SH+MH at 6k and 32k, SubEM/EM. Out of scope —
  64k/262k, other MemoryAgentBench competencies, product changes.
- Acceptance (both):
  - *Given* prepared data and valid env, *when* the operator runs `--dry-run`, *then* the plan
    (tenants, captures, questions, est. USD) prints and nothing touches DB or LLM.
  - *Given* a missing required flag or env var, *when* the CLI starts, *then* it exits non-zero
    naming the missing item before any DB/LLM work.
  - *Given* a completed run, *when* `summary.md` is opened, *then* it shows config, models,
    decisions, n, headline metric with breakdowns, baseline/lift, USD, wall time and git sha.
  - *Given* an interrupted run, *when* it is restarted with `--resume`, *then* answered questions
    are skipped and the final summary covers all of them exactly once.
  - *Given* an ingest failure after the pipeline's 3 retries, *when* it happens, *then* the run
    stops with the failing tenant + thought and no partial summary is written as if complete.
