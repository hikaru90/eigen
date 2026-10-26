# Improving Eigen's PersonaMem-v2 score

Status: **approved by the operator 2026-10-25** — S0 and S1 in progress. Every change must improve Eigen for real users, not only the
benchmark (AGENTS.md: generalize, no thought-specific or benchmark-specific patches).

## Where we are (evidence)

deepseek-v4.1-flash, persona 78, `--evidence-only --answer ask`, 5 questions: **eigen 2/5,
no-memory 0/5** (`evals/reports/public/personamem-v2/deepseek-v4.1-flash-1017-2026-10-25T21-45-49-443Z`).

| Miss | Cause | Class |
| --- | --- | --- |
| photos | evidence never says "I photograph"; nothing retrieved for "lesser-known spots" | retrieval of implicit evidence |
| anemia | memory in Chinese, question in English; nothing retrieved; keyword search drops CJK (`buildLexicalTsQuery` keeps `a-z0-9` only) | cross-language retrieval |
| anxiety | right note retrieved, but the correct option hinges on another preference (guzheng) not in this evidence | evidence-only artefact |

Also known: `ask_to_forget` is 21% of the benchmark; Eigen stores "Please forget that I…" as an
ordinary thought and forgets nothing.

## Ground rules

1. **Tune on `val`, report on `benchmark`.** PersonaMem ships `val.csv` (2,600 queries, personas
   disjoint from the benchmark split). All iteration uses a fixed dev set from `val`; the
   benchmark split is only run for reported numbers. Otherwise the score is overfit and not credible.
2. **Two metrics per run, always:** *evidence retrieved* (in evidence-only mode every thought/note
   in the tenant is evidence, so "chooser context non-empty" = retrieval hit) and *accuracy*
   (eigen vs no-memory), split by `pref_type`. A change must say which metric it moves.
3. **Both models** (D1): gpt-4o-mini and deepseek-v4.1-flash.
4. One change at a time; dev-set before/after in the commit message.

## Steps (ordered by leverage)

### S0 — Dev set and fast loop (harness)
- `prepare.py` also prepares `val.csv`; dev set = 60 evidence-only questions from `val`, seeded,
  stratified by `pref_type` (incl. `ask_to_forget`), fixed in a committed id list.
- Summary adds *evidence-retrieved rate* and, per miss, the best candidate score that fell under
  the relevance floor (so "nothing retrieved" can be told apart from "below 0.22").
- Done when: one command runs the dev set and prints both metrics.

### S1 — Unblock parallel runs (product bug)
- Fix the connection-pool deadlock found 2026-10-25: nested reservations inside a reserved
  tenant connection (e.g. billing checks) exhaust `DB_POOL_MAX` at ~4 concurrent captures and hang
  forever. Nested work must reuse the held connection or acquire with a timeout and fail loud.
  Affects production under load, not only the harness.
- Done when: `--tenant-concurrency 5` completes; a test reproduces the old hang shape.

### S1.5 — Relevance-floor test on full history (approved 2026-10-26)

Dev-set baseline (deepseek, evidence-only, `…deepseek-v4.1-flash-1017-2026-10-25T22-34-41-694Z`):
eigen 51.7%, no-memory 30.0%, evidence retrieved 83%. 11 of 29 misses had their best thought at
0.209–0.219, just under `COMPOSE_ANSWER_RELEVANCE_MIN` = 0.22. Evidence-only can't judge a lower
floor (everything stored is evidence), so the test runs on **full history**.

Harness + one eval-only hook:
1. **Val histories.** Select 20 `val` personas (seeded `val-full-1`, benchmark personas excluded,
   all their questions) and download only their `chat_history_32k` files
   (`prepare.py --split val --print-history-urls` for those personas). Full-history mode on `val`
   then works for exactly those.
2. **Eval-only floor override.** `withEvalRelevanceFloor(x, fn)` (AsyncLocalStorage, harness users
   only, same guard as `eval-chat-model.ts`) read by `composeAnswer` (thought floor) and the note
   search floor. No change for real users. CLI `--relevance-floor product|<0..1>` (required, shown
   in summary + run.json; resume refuses a change).
3. **Answer again without re-ingesting.** `--reuse-ingest <runId>`: answer against the tenants that
   run ingested, verified against its `ingest.jsonl` (tenant ids, capture counts, thought ids) —
   fail loud on any mismatch. Replaces the broken `--skip-ingest` count check (Phase A split
   children make thought count ≠ capture count).
4. **Full-history metrics.** Map each question's evidence turns to the history user turns they
   came from (exact text match against the history — data alignment, not meaning) and to the
   thoughts/notes those captures produced (incl. split children and linked notes). Report:
   evidence-hit rate (chooser context contains ≥1 evidence item), mean context size, accuracy
   eigen / no-memory / lift, per `pref_type`, per floor.

Runs (operator): ingest + answer at `product`, then answer-only at 0.15 and 0.10 via
`--reuse-ingest`, deepseek first. Decision rule: adopt a lower floor only if accuracy improves on
full history **and** "Not in memory" behaviour for unanswerable questions doesn't regress (the
product reason for the floor) — check with Eigen's own eval (`/eval` UI) before changing the
constant.

### S2 — "Forget" requests (product feature, ~21% of questions)
- A capture whose role is a request to forget something must remove (archive) the matching
  memories instead of being stored as a new thought. Jev decides the role (LLM, no keyword rules);
  matching reuses `delete_thoughts_by_request` (Jev candidates behind its 0.8 confidence gate).
  Same behaviour through MCP `capture_thought`.
- Moves: accuracy on `ask_to_forget`.

### S3 — Retrieval for advice questions (product, retrieval)
- Questions like "what should I eat / do / try" don't share words or meaning with the evidence
  ("dizzy after long nights", "out on the waves"). Add an LLM query-expansion step for
  advice/recommendation intents: "what about this user would matter for answering this?" →
  2–4 retrieval sub-queries (conditions, preferences, habits, constraints), merged with the plain
  query. LLM-judged, generic; `classifyQueryIntent` already classifies intent and is the place
  to gate it.
- Moves: evidence-retrieved rate (photos/anemia class).

### S4 — Cross-language retrieval (product, retrieval)
- Keyword search must not drop non-Latin scripts (CJK, Arabic, Hebrew, Cyrillic): Unicode-aware
  tokenization in `buildLexicalTsQuery` / `lexical_text`, and n-gram matching for scripts without
  spaces.
- Semantic side: measure whether qwen3-embedding matches English questions to Chinese memories at
  all on the dev set; if not, enrichment's recall cues (already generated per capture) are
  written in the capture's language **and** English, and indexed.
- Moves: evidence-retrieved rate on non-English evidence.

### S5 — Answers that use what Eigen knows (product UX; not scored by the chooser)
- `composeAnswer` refuses anything not verbatim ("Not in memory" with the surf note in hand).
  For advice intents, allow a personalised suggestion grounded in cited memories, explicitly
  marked as inferred. Fact questions keep the strict rules.

### S6 — Full-history confirmation
- After S2–S4 on the dev set: full-history runs on 20 `val` personas (both models), then the
  benchmark pilot (20 personas) and full run per `public-benchmarks.md` §5.

## Expected effect (to be measured, not promised)

S2 targets the 21% `ask_to_forget` slice; S3/S4 target the "nothing retrieved" misses, which were
2 of 5 in the smoke. The paper's reference points: frontier LLMs with full context 37–48%, their
agentic memory 55%, random 25%.
