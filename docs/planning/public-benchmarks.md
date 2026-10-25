# Public benchmark: PersonaMem-v2

Status: **approved — decisions D1–D7 confirmed by the operator** (2026-10-25). Written so that an implementation
agent can pick up any phase cold. Read §0–§2 first, then only the phase you were given.

| Claim we want to make | Benchmark | Headline metric |
| --- | --- | --- |
| "Eigen knows you" | PersonaMem-v2 (text, 32k histories) | 4-option MCQ accuracy, broken down by `pref_type` |

It runs through the **real product path**: `queueCapture` → enrich → `composeAnswer`. No
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
6. **Agents never run a benchmark** (operator instruction, 2026-10-25). No smoke, pilot or full
   run, nothing that calls an LLM or writes benchmark tenants, and an agent is never the answering
   model. Agents may run unit tests and `--dry-run` (offline: no DB, no LLM). Every real run is
   started by the operator (§5).
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
| D1 | Models (**revised 2026-10-25**) | Every benchmark runs **twice**, once per chat model: `openai/gpt-4o-mini` (comparability) and the shipped `PLATFORM_CHAT_MODEL` (`deepseek/deepseek-v4.1-flash-1017`, "Eigen as shipped"). One chat model per run drives the whole pipeline (capture, enrich, `composeAnswer`) **and** the benchmark's choose/extract step, selected with the required flag `--chat-model`. The embedding model stays the pinned `PLATFORM_EMBEDDING_MODEL` in both runs (stored vectors are 1536-d; changing it would mean re-embedding). Needs the eval-only override from Phase 0b (§3b). | gpt-4o-mini is the common backbone in published memory-system comparisons (Mem0, Zep, HippoRAG-v2 …), so it is the comparable run; the deepseek run shows whether the shipped model changes the result. Summaries state the chat model in the title. |
| D2 | PersonaMem persona system message | **Exclude.** Each 32k history starts with a `system` message holding the persona's demographics (no preferences). Eigen learns from what the user says, not from a profile dump. | Harder and more honest; report it in the summary. |
| D3 | PersonaMem capture granularity | One capture per **user** turn; assistant turns and the system message are not captured. `capturedAt = 2025-01-01T00:00Z + userTurnIndex days`, `referenceTime` = last turn + 1 day (histories have no dates; order matters for `updated` preferences, and `composeAnswer` shows memory dates by day, so minute spacing would hide the order; ≤ 136 turns stays under the 6-month staleness threshold). The chooser sees the same `stored YYYY-MM-DD` dates. | Mirrors LongMemEval `user-turn` mode, which is the adapter's default. |
| D4 | — | Dropped with MemoryAgentBench (§6). | |
| D5 | — | Dropped with MemoryAgentBench (§6). | |
| D6 | Enrich concurrency within one tenant | `--enrich-concurrency 1` (order-faithful). Parallelism comes from running tenants (personas) side by side: `--tenant-concurrency`. | Supersession/contradiction relations are computed at enrich time against existing thoughts; racing enrich is not how a real user's memory grows. Record the value in every summary. |
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

## 3b. Phase 0b — eval-only chat model override (product change, small)

**Goal:** a harness run can drive the whole pipeline on a chosen chat model without any way for a
normal user request to change models.

- New `src/lib/server/llm/eval-chat-model.ts`: an `AsyncLocalStorage<string>` plus
  `withEvalChatModel(model, fn)` and `currentEvalChatModel()`. `withEvalChatModel` rejects a
  blank model or one without a `vendor/name` shape (format check only).
- `loadPlatformLlmConfig(userId)` (`src/lib/server/billing/platform-llm.ts`): when an eval chat
  model is set, it **requires** `resolveHarnessBillingUserId(userId)` to be defined (callers pass
  the billing user; harness operators map to themselves) and throws otherwise — a non-harness user
  can never run on an override. Then `modelChat` = the override; `modelEmbedding` stays
  `PLATFORM_EMBEDDING_MODEL`. Without an override, behaviour is unchanged.
- `withEvalDb` options (`evals/harness/eval-context.ts`) gain `chatModel?: string`, which wraps
  the callback in `withEvalChatModel` — so `ingestTenant` and `composeAnswer` calls made through
  `withEvalDb` pick it up, including the enrich drain workers started inside it.
- `ingestTenant` gains a required `chatModel: string` passed through to every `withEvalDb` call.
  LongMemEval passes `PLATFORM_CHAT_MODEL` (unchanged behaviour).
- `ensurePublicBenchOperator` takes the chosen `chatModel` and returns
  `{ modelChat: chatModel, modelEmbedding: PLATFORM_EMBEDDING_MODEL }`. Drop the
  `LLM_MODEL_CHAT` / `LLM_MODEL_EMBEDDING` env checks (the flag replaces them).
- Tenant ids include a model slug so runs on different models never share a corpus:
  `public-bench-<bench>-<modelSlug>-<suffix>`, with `modelSlug(model)` in `evals/public-bench/`
  (`openai/gpt-4o-mini` → `gpt-4o-mini`, `deepseek/deepseek-v4.1-flash-1017` →
  `deepseek-v4.1-flash-1017`; lowercase, `[a-z0-9.-]` only).

**Tests first:**
- `eval-chat-model.spec.ts`: nested/isolated contexts; blank or malformed model rejected.
- `platform-llm.spec.ts`: no override → pinned models; override + harness user → override chat,
  pinned embedding; override + non-harness user → throws.
- `ingest-tenant.spec.ts`: `chatModel` reaches every `withEvalDb` call (inject/spy).
- `model-slug.spec.ts`: the two examples above; a model producing an empty slug → throws.

**Done when:** specs green; `test:unit`, `lint`, `check` green. Risk: **high** (touches the LLM
config path every request uses — the no-override path must stay byte-for-byte the same behaviour).

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
per persona (tenant public-bench-personamem-v2-<modelSlug>-p<id>):
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
(find the existing helper used by e.g. `classifyQueryIntent`; do not hand-roll fetch). It runs
inside `withEvalDb(…, { billingUserId, chatModel })` so the model is the run's `--chat-model`
(D1) — there is no separate answer model. Its USD is logged like every other call.

### 4.4 CLI

```
npm run eval:personamem -- \
  --data-dir evals/.data/personamem-v2          # required; contains prepared JSONL + data/chat_history_32k
  --personas 20 --seed pilot-1                  # or --persona-ids 78,370  or --all   (exactly one required)
  --chat-model openai/gpt-4o-mini               # required (D1); pipeline + chooser model
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

## 4b. Phase 1b — replay PersonaMem through Ask, with capture back in Ask

### 4b.1 Why (smoke run 2026-10-25, persona 78, gpt-4o-mini: eigen 0/5, no-memory 0/5)

Findings from the smoke run, most severe first:

1. **Wrong surface.** The adapter turned every chatbot user turn into a Capture. PersonaMem's
   evidence is implicit, inside pasted emails/posts/translations (~70% of scenarios). Capture's
   content split (`src/lib/server/capture/apply-capture-content-split.ts:105-125`) stores the
   request as the thought and moves the pasted body into a text note, which is never embedded or
   enriched (only keyword-matched at answer time). So the preference evidence left memory.
   PersonaMem models a user talking to an assistant that learns; in Eigen that surface is Ask, and
   Ask has never stored anything since `5141f7f6` (2026-10-23) removed `capture_thought` from it.
   **Operator decision (2026-10-25):** re-enable capture in Ask and replay PersonaMem through Ask.
2. **Harness: the chooser only saw cited thoughts.** `composeAnswer().retrieved` is filtered to
   cited ids (`src/lib/server/qa/compose-answer.ts:773`). Eigen answered "Not in memory" with no
   citations, so the `eigen` variant got zero memories and collapsed into `no-memory`.
3. **Timestamps.** Thoughts created by split / multi-task fanout and the attached text notes get
   wall-clock time (`2026-10-25`) instead of the source thought's backdated capture time.
4. With no memories the chooser prefers the generic reply, which is always a distractor — hence
   0% < 25% random. Expected for `no-memory`; not a bug.

### 4b.2 Product changes (Phase 1b-a)

- **P1 — Ask can capture again.** Put `capture_thought` back into `CHAT_AGENT_TOOL_NAMES`
  (`src/lib/server/mcp/registry.ts:770-781`) and remove the steering rejection in
  `src/lib/server/llm/agent-loop.ts` (lines ~31-55, ~107). The agent (LLM-as-judge, no string
  rules) decides per turn whether the user revealed something durable about themselves — a
  preference, circumstance, health or life fact, a change to an earlier fact, a plan — and if so
  calls `capture_thought` with `as_user: true` and a short first-person statement in the user's
  words (one capture per distinct fact). It never stores the user's question or request itself
  (the guarantee `5141f7f6` protected). When the user asks Eigen to forget something, it finds and
  deletes/archives the thought with the existing tools. The rest of the turn (answering, helping)
  is unchanged. Update the code comments that describe Ask as ask-only.
- **P2 — Ask turn callable without HTTP.** Extract the core of `handleAgentChatPost`
  (`src/lib/server/chat/handle-agent-chat-post.ts`: store user message → load history →
  `agentChat` → persist assistant turn) into a function the route and the harness both call, e.g.
  `runAskTurn({ db, userId, sessionId, message })` → `{ answer, toolCalls }`. The route keeps its
  HTTP/streaming shell. Behaviour of the route must not change.
- **P3 — eval clock.** `withEvalClock(date, fn)` + `currentEvalClock()` (AsyncLocalStorage, same
  shape and same harness-only guard as `src/lib/server/llm/eval-chat-model.ts`). When set:
  `capture_thought` without `captured_at` uses it as the capture time, and whatever date/time the
  Ask agent is told is "now" uses it. Non-harness users with a clock set → throw.
- **P4 — timestamps follow the source thought.** Thoughts created from another thought (content
  split, multi-task fanout) and text notes attached at capture inherit the source thought's
  `createdAt`, not wall clock. Generic fix (affects every backdated capture, not just benchmarks).
- **P5 — expose answer context.** `composeAnswer` additionally returns `context` = every item it
  gave the answer model (the pre-citation `contextItems`). `retrieved` keeps its meaning. No
  behaviour change.

Tests first (unit): Ask tool list includes `capture_thought`; agent-loop no longer rejects it
(update the specs that assert the rejection); `runAskTurn` persists user + assistant messages as
the route did; eval clock nested/guarded/defaults `captured_at`; split/fanout children and text
notes carry the source `createdAt`; `composeAnswer` returns `context ⊇ retrieved`. Risk: **high**
(Ask is a user-facing surface; P1 reverses a deliberate decision on the operator's instruction).

### 4b.3 Harness changes (Phase 1b-b)

- `--ingest ask|capture` (required, no default). `capture` = today's path. `ask` = per persona one
  Ask chat session; for each user turn in history order: `withEvalClock(epoch + n days)` →
  `runAskTurn` with the user's message (inside `withEvalDb(tenant, …, { billingUserId, chatModel })`)
  → drain and wait for enrichment of any thoughts the turn created (D6 order) → next turn. The
  dataset's assistant turns are not replayed; Ask writes its own replies. Turns where Ask captured
  nothing are fine.
- Tenant ids include the mode: `public-bench-personamem-v2-<mode>-<modelSlug>-p<id>`.
- Question side unchanged in mechanism: `composeAnswer` on the bare query (what Ask's
  `answer_question` tool calls), `referenceTime` = last turn + 1 day; the chooser now gets
  `composed.context` (all items, dated) instead of `composed.retrieved`.
- Outputs/summary add per persona: user turns replayed, captures Ask made, turns with ≥1 capture,
  deletes Ask made, Ask USD vs enrich USD. `--dry-run` prints turns per persona and an estimate.
- Tests first: ask-mode plan/tenant naming; ingest loop order (turn → drain → next) with injected
  `runAskTurn`/drain; chooser receives context items; cli requires `--ingest`.

### 4b.4 Run ladder after Phase 1b

Smoke again (operator): persona 78, `--ingest ask`, `--limit-queries 5`, gpt-4o-mini, then
deepseek. Read `summary.md` + how many turns Ask captured before going to the pilot.

```bash
npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --persona-ids 78 --limit-queries 5 --ingest ask --chat-model openai/gpt-4o-mini --tenant-concurrency 1 --enrich-concurrency 1
```

Per-turn log: `ask-turns.jsonl` in the run dir (captures, deletes, tools, clock mismatches, USD).
Superseded by §4b.5: `--ingest` no longer exists; every command needs `--answer ask|compose`.

### 4b.5 Outcome (2026-10-25) — superseded design

The Ask-ingest smoke (persona 78, gpt-4o-mini) replayed all 122 turns correctly but Ask stored
only 4 memories (explicitly confessional turns); none of the tested preferences reached memory.
**Operator decision:** capture removed from Ask again (Ask is ask-only, as in `5141f7f6`); the
benchmark ingests through **Capture** and answers through **Ask** (`--answer ask`: real Ask agent,
fresh session, eval clock; the chooser gets the full context of Ask's `answer_question` calls via
the eval-only compose observer). `--ingest` and the Ask-ingest mode are deleted. Kept from
Phase 1b-a: `runAskTurn`, eval clock, source-thought timestamps, `composeAnswer.context`.

**Fast smoke (`--evidence-only`):** one tenant per question holding only that question's evidence
user turns (PersonaMem `related_conversation_snippet`), then the question — about a minute,
labelled "SMOKE — not a benchmark score". `--question-ids` reruns single questions. Requires
re-running `prepare.py` once (it now keeps `evidenceTurns` and `preference`).

```bash
npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --persona-ids 78 --limit-queries 5 --evidence-only --answer ask --chat-model openai/gpt-4o-mini --tenant-concurrency 5 --enrich-concurrency 1
```

Full-history runs: same flags without `--evidence-only` (`--answer ask|compose` required).

## 5. Running (operator-owned)

### 5.1 Data download (once, ~80 MB, into the gitignored `evals/.data/`)

**PersonaMem-v2 status (2026-10-25):** already downloaded and prepared on the operator's machine
(`evals/.data/personamem-v2/`: CSV, 200 history files, `personamem.benchmark.jsonl`). On another
machine, repeat the steps below.

```bash
mkdir -p evals/.data/personamem-v2/benchmark/text evals/.data/personamem-v2/data
curl -L -o evals/.data/personamem-v2/benchmark/text/benchmark.csv https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2/resolve/main/benchmark/text/benchmark.csv
# only the 200 personas referenced by benchmark.csv (~36 MB): the agent ships a fetch list via prepare.py --print-history-urls
python3 -I evals/personamem/prepare.py --data-dir evals/.data/personamem-v2
```

### 5.2 Run ladder (each step must be green and reviewed before the next)

PersonaMem-v2 commands (operator runs these; run each step for both models, D1):

```bash
# smoke — gpt-4o-mini, then the same with --chat-model deepseek/deepseek-v4.1-flash-1017
npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --persona-ids 78 --limit-queries 5 --chat-model openai/gpt-4o-mini --tenant-concurrency 1 --enrich-concurrency 1
# pilot
npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --personas 20 --seed pilot-1 --chat-model openai/gpt-4o-mini --tenant-concurrency 4 --enrich-concurrency 1
# interrupted? add --resume --run-id <the run id printed at start>
```

Results land in `evals/reports/public/personamem-v2/<runId>/` (`answers.jsonl`, `ingest.jsonl`,
`summary.md`). `summary.md` is only written once every planned question has both variants.

| Step | PersonaMem-v2 | Est. USD | Est. wall |
| --- | --- | --- | --- |
| dry run | `--dry-run --personas 20 --seed pilot-1` | 0 | seconds |
| smoke | `--persona-ids 78 --limit-queries 5` (persona 78: 122 captures, 6 queries; there is no persona 0 in the benchmark split) | < $0.50 | ~20–50 min (122 captures serial at 10–25 s) |
| pilot | `--personas 20 --seed pilot-1 --tenant-concurrency 4` (~500 queries) | ~$5–10 | ~2–4.5 h |
| full | `--all --tenant-concurrency 8` (5,000 queries) | ~$50–80 | ~10–22 h |

Wall time is dominated by serial enrich inside each persona (D6). The smoke run measures the real
per-capture time; re-estimate pilot/full from it before starting them.

Prereqs: `npm run db:migrate && npm run db:rls`, `OPENROUTER_BASE_URL` and
`SERVICE_API_KEY_OPENROUTER` in `.env`. Every step runs once with `--chat-model openai/gpt-4o-mini`
and once with `--chat-model deepseek/deepseek-v4.1-flash-1017` (D1); the two runs use separate
tenants (model slug in the tenant id), so cost and time per step double.

After the pilot: read `summary.md`, look at the 20 worst `pref_type` rows by hand, and decide
whether we go to full or first fix a *generalized* product issue (separate task).

### 5.3 Publishing

Only full runs are publishable. A public number always ships with: benchmark + split + version,
models, D-decisions (esp. D2/D4 deviations), the `no-memory` lift, n, USD, and git sha. Never
publish a subset number as if it were the full benchmark.

---

## 6. Dropped: MemoryAgentBench Conflict Resolution

Dropped by the operator on 2026-10-25. It feeds a pre-numbered list of world facts, not a
conversation with a user, so it does not match how Eigen is used, and its serial ingest (up to
2,310 captures per tenant) takes too long. The scope is PersonaMem-v2 only.

## 7. Handoff briefs

Each brief is self-contained; give the implementing agent this file path plus one brief.

- **Phase 0 brief:** "Implement §3 of `docs/planning/public-benchmarks.md`. Read §0–§1 first. Tests
  first. Refactor LongMemEval onto the shared helpers. Do not commit. Report: files changed, test
  output, anything in §1 that turned out wrong."
- **Phase 1 brief:** "Implement §4 of `docs/planning/public-benchmarks.md` (PersonaMem-v2) on top
  of the Phase 0 helpers. Read §0–§2 first; decisions D1–D3, D6 are fixed. Tests first. You may run
  `--dry-run` only. Do not commit. Report: files changed, test output, dry-run output, open
  questions."

## 8. Requirement record

- **REQ-PB-1 (PersonaMem-v2):** In scope — text split, 32k histories, MCQ accuracy, `eigen` and
  `no-memory` variants. Out of scope — multimodal split, 128k histories, generative/open-ended
  judging, training splits, product changes.
- **REQ-PB-2 (MAB CR):** dropped 2026-10-25 (§6).
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
