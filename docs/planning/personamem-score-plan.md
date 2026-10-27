# Improving Eigen's PersonaMem-v2 score

> Parked on branch `benchmark-work` (2026-10-27): not on main.

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

### S2 — "Forget" requests at capture (approved 2026-10-26)

Evidence: full-history baseline `val-full-1-product` (deepseek, 69 q): ask_to_forget eigen 33% vs
no-memory 44% (−11 pp). "Please forget that I …" is stored as an ordinary thought and nothing is
forgotten, so the forgotten preference keeps being retrieved.

- **Decision (Jev, LLM):** a new decision kind `capture_intent` = `store` | `forget`, asked in
  the same early pre-split Jev call as `content_role` (criteria: forget = the user asks Eigen to
  forget / stop remembering / delete something about them). Shadow + enforce like the other kinds
  (`DECISION_ENFORCE_KINDS`), with `decision_shadow_log` rows.
- **On `forget`:** find the targets with the existing Jev-backed matcher behind
  `delete_thoughts_by_request` (0.8 confidence gate), restricted to the user's active thoughts
  captured **before** the forget capture (a fact restated later stays). For each target an LLM
  judge decides `archive` (the thought is only about the forgotten thing) or `edit_out` (it also
  holds other facts → remove just that detail via the existing natural-language edit path,
  `normalized_text` changes, `raw_text` stays). The forget capture itself is archived after
  processing so its text is never retrieved; an audit record (activity log) lists what was
  archived/edited — never silently.
- Same path for UI capture and MCP `capture_thought`. Notes are out of scope (record as follow-up).
- Tests: intent decision validation; target restriction to earlier thoughts; archive vs edit_out
  with fake LLM; forget capture archived; nothing matched → audit says so, capture archived;
  regression: a capture merely *mentioning* forgetting ("I forgot my keys") is `store`.
- Measure: evidence-only dev set (ask_to_forget slice), then full history (needs re-ingest).


### S2b — Forget, rebuilt: find XYZ first, then decide per hit (approved 2026-10-26)

**Evidence** (`val-full-2-deepseek`, 10 unseen personas, S2 enforced): ask_to_forget 1/8
(no-memory 3/8; `val-full-1-s3` without S2: 5/9). Audit over 167 forget captures: 8 applied (5%),
102 nothing matched (61%), 57 ambiguous (34%). The forget instruction was archived in every case,
so the chooser lost the only signal (context contained the forget request 9/9 without S2, 0/8 with).
Causes, from code:
1. The search covers thoughts only (`searchThoughts` in
   `src/lib/server/retrieval/retrieve-for-delete.ts:41`), not note passages — the plan wrongly
   scoped notes out. Ask's retrieval (`composeAnswer`) does search note passages.
2. The Jev delete gate sees only a snippet and is all-or-nothing: one candidate judged `delete`
   below 0.8 aborts the whole request (`resolve-delete-target.ts:188-197`).
3. The instruction is archived even when nothing was removed.

**Design**
1. **Find XYZ with Ask's retrieval.** Extract the retrieval half of `composeAnswer` into a shared
   function (thoughts via hybrid search + rerank, note passages via note search, S3 expansion when
   the intent asks for it) used by both `composeAnswer` and forget — one search path, no fork.
   Forget runs it for the LLM-derived target phrases (`deriveDeleteSearchQueries`), restricted to
   items created before the forget capture, with a wider pool (top 20 per phrase).
2. **Decide per hit with the full text.** One LLM judge call (json_object, evict-on-reject) over the
   hits, each shown in full (thought text; note passage ± neighbours with the note title), returns
   per hit `remove_all | remove_detail{detail} | keep` + confidence. Act on removals with
   confidence ≥ 0.8; anything below is an **unresolved** hit — left untouched and recorded. No
   all-or-nothing abort.
3. **Apply.** Thoughts: `remove_all` → archive; `remove_detail` → the existing edit service; the
   stored edit metadata must not keep the forgotten detail (generic edit label). Notes:
   `remove_detail` → edit the note body through the text-file service (passages rebuild; secret
   placeholders restored as for agent writes); `remove_all` → **archive the note** (new
   `text_file.archived_at`, migration `0084` + journal, excluded from retrieval, Notes lists and
   tools by default, restorable) — never a hard delete.
4. **Keep the instruction until everything is removed.** Archive the forget capture only when at
   least one hit was removed and nothing is unresolved. Otherwise (nothing found, or unresolved
   hits) it stays an active thought with `metadata.forgetInstruction {status, unresolved}`; the
   `composeAnswer` prompt gains one rule: a retrieved request from the user to forget something
   means do not use that information in the answer.
5. **Unchanged:** the explicit MCP/Ask `delete_thoughts_by_request` tool keeps its own Jev gate.
6. Audit rows as today plus one row per hit decision (ids, action, confidence — never text).

**Tests first:** note passage hit is found and edited/archived; mixed confident + uncertain hits →
confident applied, uncertain recorded, instruction kept; nothing found → instruction kept and
visible to composeAnswer; all removed → instruction archived; archived notes excluded from
retrieval/listing; edit metadata carries no forgotten detail; "I forgot my keys" still store;
migration journal entry present.

**Measure:** new ingest of `val-full-2` (10 personas, deepseek, ≈ $3.5): ask_to_forget slice vs
`val-full-2-deepseek` (1/8) and the overall lift.

### S2c — Multi-task fan-out contract without a redundant flag (approved 2026-10-26)
gpt-4o-mini returned `{"multiple": true, "tasks": [one]}` repeatedly →
`fanOutMultipleTasks: multiple:true needs at least two tasks, got 1` failed 4 of 10 personas in
`val-full-2-4omini`. The contract states the same fact twice. Drop `multiple`: the judge returns
`{"tasks": [...]}` in the capture's own words; ≥ 2 tasks → fan out, 0–1 → no fan-out
(`src/lib/server/memory/split-multi-task.ts`). Then resume `val-full-2-4omini`.

### S3 — Retrieval for advice questions (approved 2026-10-26)

Evidence: `val-full-1-product`: evidence reached the chooser for only 42% of questions; 28 of 38
misses had the evidence outside the ~15 retrieved items (health 14%, anti-stereotypical 30%).
Advice questions ("what should I eat / try / do") don't resemble the implicit evidence.

- **Intent (LLM):** extend `classifyQueryIntent` (`src/lib/server/retrieval/classify-query-intent.ts`)
  with `personalization: boolean` — the answer should depend on who the user is (preferences,
  health, habits, constraints, circumstances) rather than on one stored fact.
- **Expansion (LLM):** when true, one call produces 2–4 retrieval sub-queries describing what
  about the user would matter ("health conditions affecting energy", "foods the user avoids",
  "physical activities the user enjoys on trips"). Each runs through the normal hybrid retrieval;
  results merge with the original query by reciprocal-rank fusion, deduplicated, into the same
  top-K budget before rerank. No keyword rules; the LLM writes the sub-queries.
- Applies to `composeAnswer` (Ask's `answer_question`, MCP). Cost: +1 small LLM call per
  advice question; logged like other calls.
- Tests: intent field validation; expansion only when personalization; RRF merge + budget;
  sub-queries never carry option text; fact questions unchanged.
- Measure: answer-only A/B on the existing ingest — `--reuse-ingest val-full-1-product` (cheap,
  no re-ingest) — evidence-hit rate and accuracy vs the baseline; plus the evidence-only dev set.


### S6a — Confirmation run on unseen personas: S2 + S3 (planned 2026-10-26)

**Question:** do S2 (forget at capture) and S3 (advice-question retrieval) hold on personas we
never looked at? S3 was measured on `val-full-1` (Eigen 40.6% → 50.7%, no-memory 29.0%,
evidence hit 42% → 50%, fixed 10 / broke 3) — the same personas used to diagnose it.

**Set `val-full-2`:** 10 val personas — the first 10 of seed `val-full-2` (sha256 order over val
personas not in the benchmark split and not in `val-full-1`; reduced from 20 on 2026-10-26 to fit
the OpenRouter budget for both models): 77, 112, 152, 373, 381, 400, 475, 830, 833, 915 —
40 questions (neutral 9, ask_to_forget 8, stereotypical 7, health 6, anti-stereotypical 6,
sensitive 3, therapy 1). Histories downloaded, `prepare.py --split val` re-run.

**Config:** `.env` `DECISION_ENFORCE_KINDS` now includes `capture_intent` (S2 active at ingest).
S3 is always on in `composeAnswer`.

**Runs (operator or Claude in background; durable: cache, per-capture resume, preflight):**
1. `val-full-2-deepseek` — fresh ingest + answers, `--chat-model deepseek/deepseek-v4.1-flash-1017`.
2. `val-full-2-4omini` — same with `--chat-model openai/gpt-4o-mini` (separate tenants).

**Budget:** measured cost of a 2.3k-capture full-history run on deepseek was **$8.98**
(`val-full-1-product`); the dry-run estimate ($4.00) uses $0.0015/capture and is ~2× too low, so
preflight under-budgets — runs stay safe (resumable) but can stop on the OpenRouter limit.
With 10 personas each run is ≈ $4.5, so both fit the ~$12.7 left on the $20/week key. Time ≈ 3 h each (5 tenants in parallel); runs 1 and 2 can run concurrently when budget
allows.

**Read-out (per model):** Eigen accuracy, no-memory, lift, evidence-hit, per pref_type, with
`val-full-1` S3 numbers alongside. **Confirmed** if Eigen ≥ 45% and lift over no-memory
≥ +15 pp on the new personas (val-full-1 S3: 50.7%, +21.7 pp); ask_to_forget is the S2 slice
(val-full-1 S3: 56%). Limits: no S2-off / S3-off arm on the new personas — attribution would
need an eval-only S3 toggle (answer-only, cheap) and a second ingest for S2 (expensive); not
planned unless the result is ambiguous.

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
