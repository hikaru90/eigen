# Jev fixes: store deliberately, judge what matters, finish forgets — with a fast loop

Status: **draft for the operator (2026-10-27)**. Nothing is built. Risk: **critical** (capture,
retrieval and forget are critical-path). Follows [`jev-everywhere-rollout.md`](./jev-everywhere-rollout.md)
(J1 shipped in c6f6e024). Planner: Opus. Builders: Sonnet subagents, one phase at a time, tests
first, no commits, no LLM/DB runs. The planner runs every probe and Jev check itself.

## Why (evidence from `val-full-2-4omini-jev`, 2026-10-27)

13/40, against 16/40 (facts run) and 15/40 (before facts). The causes are measured, not guessed. The
replay script is `scratchpad/diag-relevance.ts`; it reads from the run's LLM cache.

1. **Jev's relevance step drops the evidence.** Of 569 candidate thoughts, 484 were judged `not`
   (85%). Notes: 178 of 195. Personal details mentioned in passing inside an unrelated item are
   judged as a whole and dropped: "…my quarterly endocrinology check-in…" for an energy question
   (`not` 0.71); "…before my morning ride into the office" for an outdoor-activity question
   (`not` 0.71). The criteria (`retrieval/reranker.ts:18`) call an item "about something else"
   `not`, and the drop takes the top choice with no probability gate.
2. **The evidence often never becomes a candidate.** In 3 of 8 replayed questions it was not in
   the top 15; elsewhere only a fragment was. The slots were taken by turns with nothing in them:
   "Thanks, this is great!", "I really like your version!", "Can you suggest a way to make the
   opening sentence even more engaging?", plus a split piece that was only "Thanks,".
3. **Forget never finishes.** Of 159 forget captures, 0 were applied, 44 partial and 115
   unresolved. An unsure **keep** (confidence < 0.8) counts as unresolved
   (`capture/apply-forget-request.ts:142`), and about 1,300 of the hit decisions were unsure keeps.
   So the instruction thought is never archived. The answer then reads "Please forget that I
   find relaxation in swimming laps" next to swimming options, and picks swimming.
4. **The user's own name is filed as another person.** Persona 400 signs their emails "Best,
   Sebastián". Fact extraction does not know who the user is, so it files those facts under a
   person "Sebastián", and the answer treats them as someone else's.

## How far we drifted from the product idea

The baseline ([`01-requirements-baseline.md`](./01-requirements-baseline.md),
[`grounding-onboarding.md`](./grounding-onboarding.md)) says:
- Capture is deliberate: the user submits a thought.
- Grounding onboarding is required before the first capture, so Eigen knows who the user is.

The drift:

- **Every capture is stored.** No decision can say "nothing to remember". `capture_intent` only
  knows `store | forget`, and `store` explicitly includes "or a question"
  (`llm/decision-plane.ts:176`), so a request sent to an assistant becomes memory. It is also
  decided during enrichment, after the row is already stored (`capture/enrich-queued-thought.ts:300`).
- **The split can create pieces with no content** ("Thanks," as its own thought).
- **The benchmark harness skips onboarding.** Benchmark tenants have no name and no profile; a
  real user cannot capture without one.
- **Answer-side decisions are made per whole item**, while the part that matters is often one
  sentence (relevance).
- **The forget gate is stricter than its purpose:** an unsure "this is not it" blocks a finished forget.

PersonaMem feeds every chat turn as a capture. That stays: it is what the dataset is, and an
agent capturing a conversation over MCP does the same. The product has to decide what is worth
keeping, which is J4.1.

## Operator decisions

- **Not personally relevant → not stored at all** (operator, 2026-10-27). No row, no note, no
  embedding, no text in any log. The capture answers explicitly that nothing was stored. There is
  no "store anyway".
- **Benchmarks run like the app** (operator, 2026-10-27): each persona tenant gets an account name
  and an onboarding profile before its first capture, as grounding onboarding would produce.
- **D1 (open): which persona fields go into the onboarding profile.** Proposal: only what the
  grounding chat asks first.
  - Identity: name, city/country, languages.
  - Work: job title, industry, employer type.

  Left out: hobbies, lifestyle, personality, values, family, health, gender, age, ethnicity. The
  PersonaMem persona block holds answers to the questions ("prefers biking in the city"), and a
  profile that carries answers would make the score meaningless.
- **D2 (open): the operator's "recursive Jev" idea** (judge passages/chunks, then work upward).
  The message was cut off. J4.3 below is my reading of it and waits for the full idea.

## The fast loop (build first: J4.0)

No more full runs until the probe set passes. Two tools:

### J4.0a — Jev criteria check (`npm run jev:check`)
- **Fixtures:** `evals/jev-check/fixtures/<kind>.json`. Each item is `{ state, item, expected, why }`.
  The items are real texts (PersonaMem turns, product examples), positives and negatives, about
  10–20 per kind.
- **Runner:** builds each question exactly as production does (same criteria constants, same
  instruction builders, same `runEnforced*Decisions`). It prints one table per kind: expected,
  Jev's choice, probability, and a flag for disagreements and for agreements below 0.8. It writes
  nothing to the DB and costs about 1¢. It also measures the largest batch one Decisions call
  accepts, which was never measured (J1 caveat).
- **First kinds**, the ones this plan touches plus one known-bad: `capture_intent` (with the new
  `nothing` option), the split span gate (J4.1), `evidence_relevance`, `fact_subject`,
  `forget_action`, `forget_residual`, `retrieval_scope` (flagged wrong in the J1 review).
  Fixtures for the other enforced kinds follow in J2/J3.
- The planner writes the expected labels; the operator can review them.

### J4.0b — Probe set (`npm run probe`)
- **Cases:** `evals/probe/cases.json`. The planner selects the turns from the replay, by history
  turn index.
  - E1–E8: the 8 replayed questions. Each gets its evidence turns plus the ~10 turns that
    outranked the evidence in the replay, so the competition is real.
  - G1–G8: the 8 forget questions. Each gets the turns stating the preference, the forget turn
    and noise.
  - S1: persona 400's signed email (fact subject).
  - N1: turns with nothing to remember ("Thanks, this is great!", "I really like your version!",
    "make the opening sentence more engaging", "suggest a title"). These are contrasted with
    turns that look similar but carry implicit evidence ("Why do some journeys sharpen our sense
    of observation?").
- **Two modes:**
  - `--answer-only`: replays search → relevance → answer context against the tenants of a named
    run that are already in the DB. It takes seconds and less than a cent; use it for J4.3.
  - Full mode: one fresh mini tenant per case (`probe-<case>`). Each tenant is onboarded (J4.2),
    the case's turns are ingested through the real capture path, then the forget turns run, then
    the questions are asked. Tenants run in parallel; estimate 5–10 min and under $0.50 for all
    cases (measure the first run).
- **Output:** a table of cases against stages, pass or fail, with Jev's choice and probability at
  each stage:
  1. Capture: what each turn became (nothing / thought / pieces / note / facts); a no-content turn
     has no row; the evidence detail is stored; facts are about the user.
  2. Search: the evidence item is among the candidates (rank shown).
  3. Relevance: the evidence item is kept (choice, probability).
  4. Forget: per hit action and confidence; the final status; the instruction is archived; the
     forgotten item is absent from search.
  5. Answer: the evidence is in the answer context; the forgotten preference is absent. The
     chooser's letter is printed for information only, not scored.
- Uses the eval LLM cache and the eval-only overrides (chat model, clock), restricted to harness
  users. It is not durable (small), and it gives no score.

## Phases (each: unit tests first → build → criteria check for its kinds → its probe cases pass)

### J4.1 — Store deliberately: "nothing to remember" is not stored
- `capture_intent` becomes `store | forget | nothing`. Draft criteria, to be tuned with jev:check:
  - `store`: the text says something about the user or their world that is worth remembering.
    That covers their own account, a fact, plan, task, preference, interest or idea, material they
    want to keep (a recipe, a document, an email they wrote), or a question that shows what they
    care about or are working on.
  - `forget`: unchanged.
  - `nothing`: conversation with an assistant that says nothing about the user. That covers
    thanks, praise or acknowledgement; instructions about a draft or task in progress ("make the
    opening more engaging", "suggest a title"); greetings and small talk. Storing it would teach
    Eigen nothing about the user.
- **Decided at capture, before anything is persisted**, on every capture path: the Capture UI
  (`/api/capture/interpret` runs it alongside the interpret call, so no added wait), MCP
  `capture_thought`, the agent's capture tool, and `captureThought` in `capture/service.ts`.
  - The decision is stored with the row (`store | forget`), and enrichment reads it instead of
    deciding again. The forget flow stays where it is.
  - `nothing`: no row, no note, no embedding; the activity log gets the decision only (kind,
    probability, never text). The UI shows "Not stored: nothing to remember". MCP returns
    `{ stored: false, reason: 'nothing_to_remember' }`.
  - A failed decision fails the capture loudly (no fallback store).
- **Split pieces:** the spans the split proposes pass one batched Jev gate (`store | nothing`) per
  capture. A span with nothing in it ("Thanks,") is not stored.
- **Harness:** ingest progress records `not_stored` per capture, so a resume does not retry it.
  An evidence turn that was not stored is reported as "evidence dropped at capture", a separate
  count. Today `evidenceItemIds` throws on a capture without a thought; that changes to this
  explicit outcome. Every dropped evidence turn is a gate error to look at.
- **Docs:** update AGENTS.md "Capture flow", `01-requirements-baseline.md` ("System stores the
  thought immediately") and the repo map.
- **Acceptance:**
  - Given "Thanks, this is great!" captured, then no thought, note, embedding or fact exists and
    the response says nothing was stored.
  - Given "Why do some journeys sharpen our sense of observation?", then it is stored.
  - Given an email the user asks to polish, then the personal detail in it is stored.
  - Given a mixed capture whose sign-off is "Thanks,", then no thought holds only "Thanks,".
  - Given a failing Decisions call, then the capture fails with an explicit error and nothing is
    stored.
  - The same holds in German (no string rules).

### J4.2 — Eigen knows who the user is (harness onboarding + name in fact decisions)
- **Harness:** before a tenant's first capture, set the account name (Better Auth `user.name`) to
  the persona's name. Write `user_grounding_profile` through the product's own service
  (`mergeGroundingFacets`) with the D1 fields, and set `initial_completed_at`. Record the profile
  in the run's config so it is inspectable.
- **Product:** fact extraction (chat candidates) and the Jev fact decisions get the user's name
  and identity facet in their state ("The user is Sebastián Alvarez, media archivist in Austin").
  - `fact_subject` criteria for `user` gain: texts the user wrote, sent or signed (their own name
    in a signature, "I" in their own email) are about the user.
  - The name comes from the account and the identity facet; no string matching of names in code.
- **Acceptance:**
  - Given persona 400 onboarded and their signed email captured, then its facts have subject
    `user`.
  - Given "My friend Mia barely drinks water", then the fact's subject is still Mia.

### J4.3 — Relevance judged where the meaning is (waits for D2)
My reading of the operator's idea. Adjust when the full idea arrives.
- **R1 criteria:**
  - `relevant` includes a personal detail mentioned in passing inside an item about something
    else (a condition, habit, routine, place, constraint), when a good answer should take it into
    account.
  - `not` is only for items that tell the answer nothing about the question or the user's
    situation in it.
- **R2 passages:**
  - A candidate longer than one passage is judged per passage, using the existing passage
    chunker of `note_passage`. All passages of all candidates go in one batched call, within the
    measured batch limit.
  - An item's verdict is its best passage.
  - The answer sees the item with its relevant passages (for a note: those passages instead of
    the default excerpt).
- **R3 gate:** an item is dropped only when P(not) ≥ the floor; start at 0.8 and set the final
  value from the probe cases. Kept items are ordered by expected relevance, as today.
- **R4 wider pool:** the search hands Jev more candidates (thoughts 15 → 40) because Jev, not
  the fusion rank, decides. The estimated cost is ~$0.002 per question; measure it.
- **Acceptance (answer-only probe):**
  - E1–E8: every evidence item that is a candidate is kept, at its passage.
  - The N1 turns, as stored before J4.1 in the old tenants, are judged `not`.
  - The context per question stays within the budgets.

### J4.4 — Forget finishes
- **Unresolved** means: a removal (`remove_all | remove_detail`) chosen with confidence < 0.8, or
  the residual check finds an item that still states it. An unsure **keep** is not unresolved.
  The residual check stays the safety net, re-searching after the removals.
- **Acceptance (G1–G8):** status `applied`; the instruction is archived; the forgotten preference
  is absent from search and from the answer context; near matches (keep) are untouched.
- **Unit tests:**
  - An unsure keep no longer blocks archiving.
  - An unsure removal still does.
  - A residual "still states it" still does.

## Order and gates

J4.0 → J4.1 → J4.2 → J4.4 → J4.3 (after D2).

Each phase closes when all of these hold:
- its unit tests are green;
- `npm run jev:check` shows no disagreement on its kinds, and the operator has seen any low
  confidence;
- its probe cases pass stage by stage.

The planner reviews the diff, then commits to main. A full PersonaMem run happens only after all
probe cases pass, and only when the operator decides. Budget: about $9 is left on the OpenRouter
key.

## Out of scope here
- J2/J3 of the rollout (interpret/edit/GTD/project/temporal/grounding/board/patterns to Jev,
  removal of dual chat paths).
- F3 community profiles and F4 harness consolidation.
- Fact trivia ("The user finds stories charming"): measure again after J4.1/J4.2 before touching
  `fact_keep`.
- Updating `user-facts-layer.md` (stale on reconciliation) is a separate docs task.
