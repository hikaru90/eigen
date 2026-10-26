# Kill rehearsal (run this before any long PersonaMem run)

Proves the acceptance criterion of `docs/planning/durable-benchmark-runs.md`: after a hard kill at
any point, `--resume` finishes the run with no paid call repeated for work that had completed, no
question answered twice, no tenant reset. Costs a few cents (2 val personas, first 12 user turns
each, 3 questions each, deepseek). The result is **not a score** (`REHEARSAL - not a score` in the
title of `summary.md`).

Needs: `OPENROUTER_BASE_URL`, `SERVICE_API_KEY_OPENROUTER` (the key must have a credit limit set -
the preflight reads the credit left from `GET /api/v1/key`), `DATABASE_URL`, migrations applied,
and the val histories of personas 3 and 178 under `evals/.data/personamem-v2/data/chat_history_32k`
(already downloaded).

The three commands (run them one after the other from the repo root; the run id is
`rehearsal-1` - use a new id, e.g. `rehearsal-2`, to repeat):

```sh
# 1. new run; the process SIGKILLs itself after the 15th paid ingest call
EVAL_CRASH_AT=ingest:15 caffeinate -i npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --split val --chat-model deepseek/deepseek-v4.1-flash-1017 --answer ask --tenant-concurrency 2 --enrich-concurrency 1 --relevance-floor product --persona-ids 3,178 --limit-queries 3 --max-history-turns 12 --run-id rehearsal-1 --fresh

# 2. resume; ingest continues, the process SIGKILLs itself after the 3rd paid answer call
EVAL_CRASH_AT=answer:3 caffeinate -i npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --split val --chat-model deepseek/deepseek-v4.1-flash-1017 --answer ask --tenant-concurrency 2 --enrich-concurrency 1 --relevance-floor product --persona-ids 3,178 --limit-queries 3 --max-history-turns 12 --run-id rehearsal-1 --resume

# 3. resume to completion
caffeinate -i npm run eval:personamem -- --data-dir evals/.data/personamem-v2 --split val --chat-model deepseek/deepseek-v4.1-flash-1017 --answer ask --tenant-concurrency 2 --enrich-concurrency 1 --relevance-floor product --persona-ids 3,178 --limit-queries 3 --max-history-turns 12 --run-id rehearsal-1 --resume
```

Commands 1 and 2 end with the shell reporting `Killed: 9` (exit 137): that is the rehearsal working.
Run `npm run eval:personamem -- ... --dry-run` with the same flags first to see the plan offline.

## What "pass" looks like

Everything is in `evals/reports/public/personamem-v2/rehearsal-1/` and in each process's console
tail (`process outcome: ...` followed by four counter lines). `processes.jsonl` holds the same
counters per process (`start` / `end` rows; a killed process has a `start` and a `crash-hook` row
but no `end`).

1. **Command 1** - `processes.jsonl` has a `start` and a `crash-hook` row (`phase: ingest, n: 15`)
   and no `end`. `ingest-progress.jsonl` has `queued` rows and some `enriched` rows.
2. **Command 2** - console, near the top: `<tenant>: resuming - A/12 capture(s) already enriched, B
queued but not enriched (re-enriched, not re-queued), C still to queue`, with A + B + C = 12.
   At the end of the process (it is killed, so read `processes.jsonl` or the crash row): the
   `crash-hook` row has `phase: answer, n: 3`. No tenant was reset: no `reset` of a tenant happens
   on `--resume`, and `ingest-progress.jsonl` still has the rows of command 1 unchanged at its start.
3. **Command 3** - the last lines read:
   - `process outcome: complete`
   - `paid calls by phase: ingest X, answer Y, ...` - X and Y cover only work that command 2 never
     reached or had in flight; the work that finished before each kill appears under `cache hits`
     (`ingest resume: S capture(s) skipped ...` and `answer resume: ... stored stage(s) reused`
     show what was not redone).
   - `ingest resume: ... queued now` is 0 or only the captures command 2 never reached; nothing is
     queued twice (`ingest-progress.jsonl` has exactly one `queued` row per capture index per tenant;
     it fails loud on load otherwise).
4. **No duplicate answers** - `answers.jsonl` has exactly 12 rows (6 questions x eigen, no-memory)
   and each `questionId` appears twice (once per variant):
   `jq -r .questionId evals/reports/public/personamem-v2/rehearsal-1/answers.jsonl | sort | uniq -c`
   prints 2 for each of the 6 questions.
5. **Summary complete** - `summary.md` title starts with `REHEARSAL - not a score - PersonaMem-v2`,
   `summary.json` has `"complete": true` under `metrics`, `failures.jsonl` does not exist or every failure in it
   was retried (the last console block is not `RUN INCOMPLETE`).
6. **Optional idempotence check** (costs nothing): repeat command 3's flags with `--run-id
rehearsal-2 --fresh` and no `EVAL_CRASH_AT`. Its end counters must read `paid calls by phase:
ingest 0, answer 0` - every call of the whole run is in the cache, so none of the three
   processes above paid for anything twice under a different prompt.

If a resume pays for work that finished before the kill (large `paid` counts for `ingest` in
command 2 that exceed the captures it had not started), do not start the long run: the cache key
of that call differs between attempts, which means its prompt is not deterministic (look for a
wall-clock value or a random id in it).
