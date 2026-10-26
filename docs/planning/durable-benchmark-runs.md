# Durable benchmark runs: no lost data, no paid call twice

Status: **approved by the operator 2026-10-26**. Applies to `evals/personamem/` (and the shared
`evals/public-bench/` helpers, so LongMemEval inherits it). Risk: **high** (money + data).

## Why (current behaviour, verified in code)

1. A persona interrupted mid-ingest is re-ingested from zero on resume — `ingestTenant` deletes the
   tenant (`evals/public-bench/ingest-tenant.ts:73`). One crash at hour 2.5 with 5 parallel
   tenants discards up to 5 half-finished personas.
2. Any error ends the whole process, interrupting the healthy tenants (→ point 1).
3. A torn last line in a JSONL file makes `--resume` refuse the run
   (`evals/public-bench/run-output.ts:71`).
4. No response cache: anything repeated is paid again; a question interrupted between the Ask
   answer and the chooser is answered again from scratch.
5. No preflight: no check of OpenRouter credit, harness wallet, DB or sleep.

## Acceptance criterion (the one that matters)

After a hard kill at any point, `--resume` completes the run with **zero paid LLM/embedding calls
for work that had completed before the kill** (at most the call that was in flight is repeated),
no question answered twice in `answers.jsonl`, and no tenant reset. Proven by the kill rehearsal
(§8) before any long run.

## Design

### 1. Response cache (eval-only)
- `withEvalLlmCache(dir, fn)` (AsyncLocalStorage, harness users only — same guard pattern as
  `src/lib/server/llm/eval-chat-model.ts`). Honoured by chat completions and embeddings in
  `src/lib/server/llm/llm-client.ts` / `embedding.ts`, and by the Jev decisions client
  (`decision-client.ts`).
- Key = sha256 of a canonical JSON of {endpoint, provider, model, full request body: messages,
  temperature, response_format, max_tokens, …}. Value = the raw response + usage + cost.
- **Write-before-use:** the response is persisted (temp file → fsync → rename) before it is
  returned to the caller. Location `evals/.data/llm-cache/<runId-independent>/<model-slug>/<hash>.json`
  — shared across runs, so a rerun of identical work is free too.
- A hit charges nothing: no wallet debit, `activity_call_log` row with 0 USD and a `cached` marker
  so cost reports stay true. Summary reports hits, misses, USD paid, USD avoided.
- Prompts that embed wall-clock time defeat the cache; under the eval clock they must use it.
  List any call site whose prompt still contains wall-clock values and fix it to read the eval
  clock (known: `retrieve_thoughts` temporal annotations, "ended as of <today>").

### 2. Per-capture resume (ingest)
- `ingest-progress.jsonl` per run: two-phase records per capture — `queued {tenant, index,
  thoughtId}` (written right after `queueCapture`) and `enriched {tenant, index, thoughtIds incl.
  split children}` (written after the wave's drain + wait).
- Resume: queued-but-not-enriched → drain/wait (re-enrich) that thought, never re-queue; not queued
  → queue; enriched → verify the thoughts exist and are enriched in the DB, else fail loud.
- A tenant is reset only with an explicit `--fresh` (and only before its first capture is
  recorded); `--resume` never deletes anything.

### 3. Staged answers
- `answer-stages.jsonl`: stage `eigen` {questionId, Ask answer, tools, full context, belowFloor,
  evidence}, stage `choose-eigen` {letter}, stage `choose-no-memory` {letter}. The final
  `answers.jsonl` rows are written only when all three exist. Resume continues from the last
  stage; stage `eigen` is never recomputed once stored.

### 4. Isolated failures
- Each tenant (ingest) and each question (answer) runs in its own error boundary. A failure is
  recorded in `failures.jsonl` {tenant|questionId, phase, error message, time} and the run
  continues with the rest. The end report lists failures loudly, the process exits non-zero, and
  `summary.md` is marked incomplete. `--resume` retries failed and unfinished items only.
  (Not a silent fallback: every failure is recorded, reported and blocks the "complete" state.)

### 5. Crash-safe files
- `appendJsonl` writes with an fsync per record. On read, a torn **last** line (unparseable, no
  trailing newline) is moved to `<file>.torn-<timestamp>` with a warning and the run continues; a
  bad line anywhere else still fails loud.

### 6. Clean stop
- First SIGINT/SIGTERM: start no new wave/question, let in-flight calls finish, flush, print the
  exact `--resume --run-id <id>` command, exit 130. Second signal: exit immediately (still safe by
  §2/§3/§5).

### 7. Preflight (before the first paid call; fail loud with what's missing)
- OpenRouter credit vs. the run's estimate (+ margin) via the OpenRouter key/credits endpoint;
  harness platform-credit wallet vs. estimate; DB reachable and migrations applied; data/history
  files present; run dir writable.
- `--run-id` required for non-dry runs (so resume is always one known command).
- On macOS, warn unless the process runs under `caffeinate` and print the command to use.

### 8. Kill rehearsal (proves the acceptance criterion)
- Eval-only crash hook `EVAL_CRASH_AT=<phase>:<n>` (phases: `ingest`, `answer`): after the n-th
  completed paid call in that phase, the process sends itself SIGKILL. Harness only; refuses to
  arm outside the eval CLI.
- Rehearsal flag `--max-history-turns N` (labelled "REHEARSAL — not a score") caps each persona's
  history for a quick full-history run.
- Rehearsal script/runbook: 2 val personas, `--max-history-turns 12`, deepseek:
  run with `EVAL_CRASH_AT=ingest:15` → resume with `EVAL_CRASH_AT=answer:3` → resume to completion.
  Pass = resumes made 0 paid calls for already-completed work (from cache/progress counters), no
  duplicate answers, no tenant reset, summary complete.

## Tests first
Cache: key canonicalisation, write-before-use, hit = no wallet debit + 0-USD log row, guard.
Ingest: two-phase progress, resume from each state, `--fresh` rules, DB-verification failure.
Answers: resume from each stage, final rows only when complete, no duplicate rows.
Failures: one tenant throws → others finish, failures.jsonl, exit code, incomplete summary.
Files: fsync append, torn-last-line recovery, mid-file corruption still throws.
Signals: first/second signal behaviour (simulated). Preflight: each missing prerequisite.
Crash hook: arms only in the harness, kills after n paid calls.
