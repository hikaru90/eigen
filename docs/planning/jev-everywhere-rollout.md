# Jev everywhere — rollout of every bounded decision to the decision plane

> Parked on branch `benchmark-work` (2026-10-27): not on main.

Status: **J0 audit and J1 built** (2026-10-27, by subagent while the operator slept; unit-tested, not yet measured — no benchmark was run). J2/J3 not started. Operator directive (repeated 2026-10-27, first
issued 2026-10-16 in `09-jev-decision-plane.md`): **use Jev wherever possible.** Risk: **critical**
(ingestion, retrieval, forget). Builds on `09-jev-decision-plane.md` (engine, Decisions API,
shadow/enforce, `DECISION_ENFORCE_KINDS`).

## Why now (evidence)

`val-full-2-4omini-facts` (2026-10-27): the facts layer barely moved the score (16/40 vs 15/40)
and forget fell to 0/8. Root causes are decisions made by the **chat model** instead of Jev:

- Fact keep/drop ("personally relevant?") was judged by gpt-4o-mini inside the extraction call →
  fragments ("The user."), trivia ("faint scent of oolong"), writing-task notes as facts.
- Fact retrieval had no relevance decision → the same ~20 facts for every question, context
  doubled (19 → 38 items).
- The forget per-hit action (remove / edit out / keep) and its confidence came from the chat model;
  "done" was declared after removing only the fact.
- New this session and also chat-judged: query `personalization`, fact reconciliation op, fact
  kind and subject kind.

The chat model self-reports confidence; Jev returns **calibrated probabilities** over a closed
set, costs ≈ $0.000014/call, ≈ 0.4–0.5 s, takes many questions per call, and is independent of the
benchmark's chat model.

## Rule (from 09, restated)

**If the answer is a key from a closed set (incl. yes/no, a band, or one of N candidates), it is
a Jev question. If the answer is new text, it is the chat model's job — and the chat model then
only generates; it never also decides.** Mixed steps are split: Jev decides, chat generates only
what the decision requires.

## J0 audit — what the code really does (2026-10-27)

Verified row by row against the code at `246be859`. **49** `llmChatCompletion(` call sites at HEAD (44 in `src/`, 5 in the eval harness; the plan said 43). J1 deleted two (the listwise rerank, the forget-hit judge): **47** remain.

**Kinds enforced in the local `.env` `DECISION_ENFORCE_KINDS`:** all 15 registry kinds that existed before J1 — `category, content_role, entity_type, relation_type, temporal_kind, retrieval_scope, query_temporal_kind, duration_unit, gtd_promotion, resolution_choice, delete_target, message_intent, open_loop, salience_band, capture_intent`. J1 appended the ten new ones (25 total). No kind is merely "shadow" in this environment; shadow only exists in code, for an environment without the setting.

**Findings that change the plan:**

1. **Every pre-J1 enforced kind is a dual path.** The chat decision is still computed next to Jev and then overridden (category in the enrich bundle + strict retry + `classify-thought-category` + `interpret-thought`; entity type and temporal kind in `entity-extraction` / `temporal-extraction`, whose parser even throws when the chat reply has no valid `entityType` although Jev overrides it; relation type, delete target, resolution, GTD promotion, content role, retrieval scope/kind/unit). With the kind in `.env` these chat answers are dead but still paid for and still able to fail the step. Deleting them is J3.
2. **`classifyQueryIntent` had a decision the plan did not list:** the `temporal` boolean (retrieval's temporal channels, compose `topK` 18, solver gating) was chat-decided. Deriving it from the temporal kind would turn on temporal retrieval for every `absolute` lookup, so J1 added a Jev kind `query_temporal` instead.
3. **The existing Jev criteria for `retrieval_scope` contradict the chat definition they replaced.** The chat prompt said global = corpus-wide sensemaking, local = a specific fact lookup; the Jev criteria say local = "the answer should come only from the immediate conversation context". For a memory question almost everything may read as global — a probable (unmeasured; read the `qa_intent` rows of `decision_shadow_log` to confirm) cause of `scope: global` for most PersonaMem questions, with compose `topK` 16, community themes and the fixed 24 facts behind the "context doubled" evidence. The temporal-kind criteria drifted the same way (`lookback`, `span`, `duration`, `count` are described more loosely than the definitions the temporal solver relies on). **Left unchanged in J1** (no behaviour change beyond the plan); proposed replacement for scope: *global — Corpus-wide sensemaking: themes, patterns, a profile of the user; needs many memories. local — A specific fact lookup or a recommendation answerable from one or a few stored items.* Operator decision.
4. **Dead code:** `retrieval/global-query.ts` (`classifyRetrievalScope`, its prompt and parser) and `classifyRetrievalScopeFromIntent` had no production caller — deleted in J1. `thought.rerank_snippet` (column + `syncThoughtRerankSnippet` write at enrich) has no reader since the rerank is gone — J3 (needs a migration).
5. **The listwise rerank lived inside `retrieveEvidence`**, so it ran for every `searchThoughts` caller (Ask, MCP `retrieve_thoughts`, `/api/retrieval/search`, relation extraction at capture, delete), skipped when the top-2 score gap was ≥ 0.15. Notes and facts were never judged; facts got a fixed top-8 (24 for `scope: global`).
6. **`apply-thought-edit.ts` has a string-heuristic decision**: `parseLifecycleEditRequest` (command-verb lists and `startsWith`, called from `capture/service.ts`) routes done/archive/open edits before the chat model sees the request. It violates the LLM-as-judge rule and belongs to J2 `edit_intent` together with the chat `status` field.
7. **`split-multi-task.ts`** decides "is this capture several distinct to-dos" on the chat (the task list; two or more fan out) — a bounded decision missing from the plan (J2).
8. **`ontology/evaluate-ontology.ts` has no propose/skip decision** — it only generates `kindGuidance` text and a summary. The planned `ontology_proposal` kind has nothing to move; dropped.
9. **Table corrections:** `board/reward-judge.ts` decides a boolean `reward`, not a band; `patterns-judge.ts` is mostly generation, its closed set is the pattern `kind` (recurring | growing | fading | scattered) per pattern plus the choice of supporting thought ids; `reconcile-user-projects.ts` decides merge groups and demotions, which `resolution_choice` (canonical hub for one label) does not cover.

**Corrected inventory** (Who decides = at HEAD, before J1; Jev = enforced in the local `.env`):

| Area | Call site | Who decides at HEAD | Jev today | Dead / dual chat path | Plan |
| --- | --- | --- | --- | --- | --- |
| facts | `facts/extract-user-facts.ts` | chat: keep/drop, subject user/person, fact kind, inferred, confidence, reconcile op | none | — | **J1 done:** chat proposes candidates; Jev `fact_keep`, `fact_subject`, `fact_kind`, `fact_reconcile`. `inferred` and the E-ref link to a Known person stay on the chat (J2 candidates) |
| forget | `capture/judge-forget-hits.ts` | chat: remove_all / remove_detail / keep + confidence + a `detail` phrase | none | — | **J1 done:** Jev `forget_action`; the edit helpers (`remove-note-detail`, `remove-fact-detail`, thought edit) now take the user's own request instead of a chat-written detail |
| forget | verify-before-done | — | — | — | **J1 done:** Jev `forget_residual` on the re-run search |
| retrieval | `retrieval/reranker.ts` | chat listwise rerank (see finding 5) | none | whole chat rerank | **J1 done:** Jev `evidence_relevance`, one batched call per Ask question over thoughts, note passages and facts |
| retrieval | `retrieval/classify-query-intent.ts` | chat: scope, temporal, kind, unit, comparativeOrdering, personalization, entityHints, timeWindow | `retrieval_scope`, `query_temporal_kind`, `duration_unit` (override the chat's three) | chat scope/kind/unit dead under `.env` | **J1 done:** six Jev questions in one call (new: `query_temporal`, `comparative_ordering`, `query_personalization`); chat only entityHints + timeWindow |
| retrieval | `retrieval/global-query.ts` | dead | — | whole file | **J1 done:** deleted |
| retrieval | `retrieval/resolve-delete-target.ts` | Jev `delete_target` per candidate (0.8 gate); live caller: MCP `delete_thoughts_by_request` | `delete_target` | chat resolver when not enforced | J3: delete the chat path |
| retrieval | `retrieval/resolve-temporal-hint-bindings.ts` | chat: binds a hint to one of N events or none (live in `composeAnswer`, twice for temporal questions) | none | — | J2 `temporal_binding` |
| retrieval | `derive-delete-search-query.ts`, `expand-personalization-queries.ts` | generation | — | — | chat |
| capture | `capture/interpret-thought.ts` | chat: interpretedText, entities, deviatesFromVerbatim, category (+ strict retry) | `category` (preview) | chat category + strict retry | J2 `interpret_deviation`; J3 delete the chat category |
| capture | `capture/apply-thought-edit.ts` | chat: lifecycle status + rewrite; plus the string-heuristic verb parser (finding 6) | none | — | J2 `edit_intent`; chat rewrites only when intent = rewrite |
| capture | `capture/enrich-thought-bundle.ts` | chat: category (+ confidence, alternatives, strict retry), cues, askQuestion, temporal, entity graph | `category` (overrides at persist) | chat category + retry (finding 1) | J3 delete the chat category + `strict-category-retry.ts`; the rest stays chat |
| capture | `capture/split-capture-content.ts` | chat generation (spans, note text) for the role Jev decided | `content_role` (early call) | role decision when not enforced | J3 |
| memory | `memory/extract-gtd-assignment.ts` | chat: which project / none, isNextAction (gated upstream by Jev `open_loop`) | none | — | J2 `gtd_assignment`, `next_action` |
| memory | `memory/judge-gtd-project.ts` | Jev `gtd_promotion`; 0.4–0.6 escalates to the chat judge (designed tiebreak) | `gtd_promotion` | chat judge when not enforced | keep the tiebreak; J3 the rest |
| memory | `memory/resolve-project-identity.ts` | Jev `resolution_choice`; below 0.6 escalates to chat | `resolution_choice` | chat resolver when not enforced | J3 |
| memory | `memory/reconcile-user-projects.ts` | chat: merge groups + demotions | none | — | J2 (not covered by `resolution_choice`, finding 9) |
| memory | `memory/detect-project-from-thought.ts` | chat: a project is mentioned + label | none | — | J2: Jev decides, chat writes the label |
| memory | `memory/apply-temporal-event-action.ts` | chat: action (mark_done, reopen, archive, reschedule, snooze, update) + dates | none | — | J2 `temporal_event_action`; chat only for new dates |
| memory | `memory/extract-project-timeline.ts`, `extract-project-review.ts`, `extract-project-order.ts` | chat: generation + closed sets inside (isNextAction, task kind, keep/mark_done/archive per task, next-action choice); order is a ranking | none | — | J2 for the closed sets (`next_action`, review verdict); order and text stay chat |
| memory | `memory/split-multi-task.ts` | chat: fan-out decision via the task list (finding 7) | none | — | J2 `multi_task` |
| memory | `memory/relation-extraction.ts` | Jev `relation_type` per pair; the chat call is skipped under enforcement | `relation_type` | chat path when not enforced | J3 |
| memory | `memory/entity-extraction.ts`, `temporal-extraction.ts` | chat: surfaces, dates, and still a type/kind + confidence per mention | `entity_type`, `temporal_kind` (override) | chat type/kind (finding 1) | J3: stop asking the chat for the type |
| memory | `memory/search-cues.ts`, `parse-date-range.ts` | generation | — | — | chat |
| ontology | `ontology/classify-thought-category.ts` (edit path), `strict-category-retry.ts` | chat category | `category` (overrides at settle) | dual | J3 |
| ontology | `ontology/evaluate-ontology.ts` | generation only (finding 8) | — | — | chat; no kind |
| grounding | `grounding/next-question.ts`, `next-relevance-question.ts` | chat: template choice (+ anchor / thought id) or skip | none | — | J2 `grounding_question` |
| grounding | `grounding/seed-projects.ts`, `synthesize-narrative.ts` | generation | — | — | chat |
| board | `board/judge.ts` | chat: kind, area, duplicate_of (candidate id or none) | none | — | J2 `board_kind`, `board_area`, `board_duplicate` |
| board | `board/reward-judge.ts` | chat: boolean reward | none | — | J2 `board_reward` (yes/no) |
| patterns | `patterns/patterns-judge.ts` | chat: insight, titles, distillations (generation) + kind per pattern + supporting thought ids | none | — | J2 `pattern_kind` per pattern; text stays chat |
| chat | `llm/agent-loop.ts` | chat: tool routing + arguments; Jev `message_intent` is an advisory hint only (soft-fail by design) | `message_intent` | — | later: first routing step |
| consolidation | `consolidation/community-summaries.ts` | generation | — | — | chat |
| answers | `qa/compose-answer.ts` | generation | — | — | chat |
| evals | harness judges, PersonaMem chooser | benchmark-side answer model | — | — | stays chat |

## J1 — delivered (2026-10-27)

Ten new Jev-only kinds (no chat path behind them; listed in `DECISION_ENFORCE_KINDS` for validation and documentation — they run whenever their surface runs and need `DECISION_SHADOW_ENABLED=true`):

| Kind | Surface | Closed set | Asked | Code |
| --- | --- | --- | --- | --- |
| `fact_keep` | `fact_derivation` | keep · drop | per fact candidate, one call with the other three | `facts/decide-user-facts.ts` |
| `fact_subject` | `fact_derivation` | user · person | per candidate | same |
| `fact_kind` | `fact_derivation` | the ten fact kinds | per candidate | same |
| `fact_reconcile` | `fact_derivation` | add · none · update_Fn · confirm_Fn | per candidate that has nearest stored facts | same |
| `forget_action` | `forget` | remove_all · remove_detail · keep | per hit, one call | `capture/judge-forget-hits.ts` |
| `forget_residual` | `forget` | yes · no | per hit the re-run search still finds, only when the instruction would otherwise be archived | same, `apply-forget-request.ts` |
| `evidence_relevance` | `evidence` | relevant · partly · not | per thought, note passage and fact, one call per question | `retrieval/reranker.ts`, `qa/retrieve-answer-evidence.ts` |
| `query_temporal` | `qa_intent` | yes · no | per question, in the intent call | `retrieval/classify-query-intent.ts` |
| `comparative_ordering` | `qa_intent` | yes · no | same | same |
| `query_personalization` | `qa_intent` | yes · no | same | same |

Behaviour decided inside J1 beyond the table (for review):

- The thought search no longer reranks; callers other than Ask (MCP `retrieve_thoughts`, `/api/retrieval/search`, relation extraction, delete) get the fusion order, i.e. what the old rerank-skip path returned when the score gap was large.
- Ask judges a pool: 15 thoughts, 5 note passages, 24 facts go to Jev; the answer sees at most the compose budget of thoughts (8 · 16 global · 18 temporal), 5 notes and **8 facts for every question**, including "what do you know about me?" (the old 24 for overview questions is gone, as asked). If Jev finds nothing relevant the answer is the "not in memory" answer without a model call. The salience bump of a retrieval now applies to the whole returned pool (15), not only to what the answer finally uses.
- Facts: the chat model no longer sees stored facts; each candidate is reconciled against its own five nearest stored facts. Two candidates may name the same stored fact; both operations are kept and the store resolves them deterministically (the old "used by more than one operation" error is gone). A candidate Jev calls a `person` fact without a proposed label fails the derivation loudly. Jev sees the capture with identifier values masked.
- Forget: a residual `yes` records the hit by id and sets the status `partial` (something was removed, something remains); the instruction stays.

## Phases (subagents build; operator reviews each)

- **J0 — audit (read-only, cheap) — done 2026-10-27:** every row verified against code: current
  engine, enforced/shadow/none, dead chat paths. Output: the corrected inventory above.
- **J1 — the score-relevant decisions — built 2026-10-27, not yet measured:** `fact_keep`, `fact_subject`, `fact_kind`,
  `fact_reconcile`; `forget_action`, `forget_residual`; `evidence_relevance` (thoughts, notes,
  facts — fixes the 24-fact noise); `query_personalization`, `comparative_ordering`. Each new kind:
  registry entry, criteria, per-item batching (one Decisions call per step), shadow-log rows,
  enforced via `DECISION_ENFORCE_KINDS` (operator directive: authoritative from the start), fail
  loud on missing/invalid answers, tests first.
- **J2 — the remaining bounded decisions:** interpret deviation, edit intent (replacing the
  string-heuristic verb parser too), GTD assignment / next action, project merge/demote and
  detection, temporal binding / event action, multi-task fan-out, grounding question, board,
  patterns kind, the closed sets inside the project extractions (the J0 table lists each).
- **J3 — cleanup:** delete chat decision paths that enforced Jev kinds made dead (no dual paths,
  per AGENTS.md); agent-loop first-step routing via `message_intent` if J0 shows it's safe.

## Measurement

J1 first on the 60-question evidence-only dev set (≈ $0.50; Jev cost negligible), then the
reduced gpt-4o-mini full-history test (10 val personas) against `val-full-2-4omini-facts`.
Per kind: decision count, Jev latency, agreement where a chat shadow still exists, and the
end-to-end effect (fact count/quality sample, context size, evidence-hit, forget slice).
