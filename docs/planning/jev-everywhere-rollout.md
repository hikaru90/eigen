# Jev everywhere — rollout of every bounded decision to the decision plane

Status: **plan for operator review** (2026-10-27). Operator directive (repeated 2026-10-27, first
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

## Inventory (43 chat call sites; J0 verifies every row against code)

Legend — **Jev**: move the decision to Jev · **split**: Jev decides, chat keeps generation ·
**chat**: pure generation, stays · **enforced?**: an enforced Jev kind already exists; J0 confirms
whether the chat path is dead (then delete it).

| Area | Call site | Decision today on chat | Plan |
| --- | --- | --- | --- |
| facts | `facts/extract-user-facts.ts` | keep/drop, subject user/other, fact kind, inferred, confidence, reconcile op | **split**: chat proposes candidate statements only; Jev per candidate: `fact_keep` (keep/drop), `fact_subject` (user/other person), `fact_kind` (catalog), `fact_reconcile` per (candidate, nearest stored fact) add/update/confirm/none; Jev probability replaces self-reported confidence |
| forget | `capture/judge-forget-hits.ts` | remove_all / remove_detail / keep + confidence per hit | **Jev** `forget_action` per hit; chat only writes the edited text for remove_detail (`remove-note-detail.ts`, `remove-fact-detail.ts` stay chat) |
| forget | (new) verify-before-done | — | **Jev** `forget_residual`: after removal, re-search; per remaining hit "still states the forgotten thing?" → instruction kept unless all no |
| retrieval | `retrieval/reranker.ts` | relevance order of candidates | **Jev** `evidence_relevance` per candidate (relevant / partly / not) for thoughts, note passages **and facts**; order by probability, drop "not" — replaces the fixed fact top-24 |
| retrieval | `retrieval/classify-query-intent.ts` | scope, temporal kind, duration unit (Jev kinds exist), comparativeOrdering, personalization; entity hints | **split**: all booleans/enums on Jev (`retrieval_scope`, `query_temporal_kind`, `duration_unit` enforced?; new `comparative_ordering`, `query_personalization`); chat only extracts entityHints / time window |
| retrieval | `retrieval/resolve-delete-target.ts` | delete target | `delete_target` enforced? → delete chat path |
| retrieval | `retrieval/resolve-temporal-hint-bindings.ts` | bind a hint to one of N events | **Jev** `temporal_binding` (choice among candidates / none) |
| retrieval | `derive-delete-search-query.ts`, `expand-personalization-queries.ts` | — | chat (generates queries) |
| capture | `capture/interpret-thought.ts` | deviatesFromVerbatim, category | **split**: Jev `interpret_deviation` (yes/no), category on Jev; chat only writes interpretedText |
| capture | `capture/apply-thought-edit.ts` | lifecycle intent (done/archive/rewrite…) + rewrite | **split**: Jev `edit_intent`; chat rewrites only when intent = rewrite |
| capture | `capture/enrich-thought-bundle.ts` | category (+ retries) | category on Jev (enforced?); delete chat category + `strict-category-retry.ts` if dead; cues/askQuestion/temporal/entity surfaces stay chat |
| capture | `capture/split-capture-content.ts` | role (Jev enforced) | chat keeps span selection only |
| memory | `memory/extract-gtd-assignment.ts` | which project / none, isNextAction | **Jev** `gtd_assignment` (choice among projects / none), `next_action` (yes/no) |
| memory | `memory/judge-gtd-project.ts` | promote/demote | `gtd_promotion` enforced? → delete chat path |
| memory | `memory/resolve-project-identity.ts`, `reconcile-user-projects.ts` | canonical / merge / create | **Jev** `resolution_choice` (exists) |
| memory | `memory/detect-project-from-thought.ts` | is a project mentioned + label | **split**: Jev decides, chat writes label |
| memory | `memory/apply-temporal-event-action.ts` | which action on an event | **Jev** `temporal_event_action`; chat only for new dates |
| memory | `memory/extract-project-timeline.ts`, `extract-project-order.ts`, `extract-project-review.ts` | task lists, order, review text | chat (generation); isNextAction → Jev `next_action` |
| memory | `relation-extraction.ts`, `entity-extraction.ts`, `temporal-extraction.ts`, `parse-date-range.ts`, `search-cues.ts`, `split-multi-task.ts` | types already Jev (relation_type, entity_type, temporal_kind) | chat keeps generation; J0 confirms no type decision is left on chat |
| ontology | `classify-thought-category.ts`, `strict-category-retry.ts`, `evaluate-ontology.ts` | category; propose/skip | category Jev (enforced?) → delete dead chat; `ontology_proposal` propose/skip on Jev |
| grounding | `next-question.ts`, `next-relevance-question.ts` | pick a template or skip | **Jev** `grounding_question` (choice among templates / skip) |
| grounding | `seed-projects.ts`, `synthesize-narrative.ts` | generation | chat |
| board | `board/judge.ts`, `board/reward-judge.ts` | accept/duplicate, reward band | **Jev** `board_verdict`, `board_reward_band` |
| patterns | `patterns/patterns-judge.ts` | pattern verdicts | **Jev** (J0 defines the closed set) |
| chat | `llm/agent-loop.ts` | tool routing + arguments | later: Jev `message_intent` (exists) for the first routing step; arguments stay chat |
| consolidation | `community-summaries.ts` | — | chat (summaries) |
| answers | `qa/compose-answer.ts` | — | chat (answers) |
| evals | harness judges, PersonaMem chooser | benchmark-side answer model | stays chat (it *is* the model under test) |

## Phases (subagents build; operator reviews each)

- **J0 — audit (read-only, cheap):** verify every row above against code: current engine,
  enforced/shadow/none, dead chat paths; produce the exact kind list with closed sets and criteria
  drafts. Output: this table corrected, in the doc.
- **J1 — the score-relevant decisions:** `fact_keep`, `fact_subject`, `fact_kind`,
  `fact_reconcile`; `forget_action`, `forget_residual`; `evidence_relevance` (thoughts, notes,
  facts — fixes the 24-fact noise); `query_personalization`, `comparative_ordering`. Each new kind:
  registry entry, criteria, per-item batching (one Decisions call per step), shadow-log rows,
  enforced via `DECISION_ENFORCE_KINDS` (operator directive: authoritative from the start), fail
  loud on missing/invalid answers, tests first.
- **J2 — the remaining bounded decisions:** interpret deviation, edit intent, GTD assignment /
  next action, project identity/merge, temporal binding / event action, grounding question,
  board, patterns, ontology proposal.
- **J3 — cleanup:** delete chat decision paths that enforced Jev kinds made dead (no dual paths,
  per AGENTS.md); agent-loop first-step routing via `message_intent` if J0 shows it's safe.

## Measurement

J1 first on the 60-question evidence-only dev set (≈ $0.50; Jev cost negligible), then the
reduced gpt-4o-mini full-history test (10 val personas) against `val-full-2-4omini-facts`.
Per kind: decision count, Jev latency, agreement where a chat shadow still exists, and the
end-to-end effect (fact count/quality sample, context size, evidence-hit, forget slice).
