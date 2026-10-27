# Capture feedback: did Eigen store this right?

Status: **draft for the operator (2026-10-27)**. C0 (criteria and `npm run jev:check`) and C1
(record, audit, score; no UI) are built; C2 to C5 are not. It builds on `main` *after* the
capture work moved to branch `benchmark-work`, so it starts once that cut has landed. Risk:
**high**: it reads every capture after enrichment and writes through the edit path. Planner: Opus.
Builders: Sonnet subagents, tests first, one phase at a time.

## Problem

The operator needs to know whether captures are stored correctly (category, people, dates, split,
wording) without ever reading anyone's thoughts.

Today:
- Jev's capture decisions are logged with probabilities, but by contract the log holds no thought
  id (`decision_shadow_log`), so no single capture can be judged.
- The parts the chat model writes (wording, found names, dates, split pieces) have no confidence
  at all.
- The `/eval` suite covers made-up data only. Nothing tells us how real captures turn out.

## Goal

Every capture gets a **score**: how sure Eigen is that it stored the capture right.
- The owner can vote 👍 or 👎 on a stored thought in two places only: right after capture (the
  stored-thought strip on Capture) and on the Mesh page (the unfolded thought row). Eigen never
  asks. There are no check-in questions and no prompts: the confirm step at capture already asks
  when the reading deviates (operator, 2026-10-27).
- A 👎 comes with "What was wrong?". That text is applied as an edit, so the capture gets fixed.
- The score never shows to the user. It feeds the operator's numbers: how often weak captures get
  👎, which is what calibrates the threshold.
- The operator sees aggregates only: counts per part, confidence band and kind of mistake. Never
  text, entity names, thought ids or user ids.

**In scope:**
- per-capture review record;
- Jev confidence for Jev-decided parts;
- a Jev audit of chat-written parts;
- score and threshold;
- 👍/👎 on the stored-thought strip after capture and on the Mesh thought row;
- 👎 reason applied as an edit, with a Jev label for the kind of mistake;
- operator aggregates page;
- MCP tools (DoD gate, `docs/testing/agent-benchmark.md`).

**Out of scope:**
- changing how capture works;
- any question or prompt asking the user to review (check-in cards, push, modals);
- any operator access to text;
- using reasons as training data;
- new push copy beyond the existing check-in push;
- feedback on Ask answers.

## Design

### 1. The parts of a capture and where their confidence comes from (post-cut main)

| Part (what the user sees) | Decided by | Confidence |
| --- | --- | --- |
| Category (task, idea, …) | Jev `category` | Jev probability |
| Type of each name (person, place, …) | Jev `entity_type` (per mention) | Jev probability |
| Link of a name to an existing one ("Mom" = the known Mom) | Jev `resolution_choice` | Jev probability |
| Relation between names | Jev `relation_type` | Jev probability |
| Kind of time / duration | Jev `temporal_kind`, `duration_unit` | Jev probability |
| Stored wording (when it differs from what the user typed) | chat (interpret / normalize) | **Jev audit** |
| Which names were found; whether one is missing | chat (entity extraction) | **Jev audit** |
| Dates and times taken from the text, and whether one was never stored | chat (temporal extraction) | **Jev audit** |
| Split pieces / one task per piece | chat (split, multi-task fan-out) | **Jev audit** |

The chat model's own "confidence" numbers (in the interpret preview) are not used: they are not
calibrated. Internal parts the user never sees (retrieval cues, ask-question) are not reviewed.

### 2. The review record: `capture_review` (migration `0083_capture_review` + journal entry)
- **Columns:**
  - `id`, `user_id`, `thought_id` (FK to thought, cascade delete);
  - `parts` (jsonb, explained below);
  - `score`, `status` (`pending_audit | scored | audit_failed`);
  - `verdict` (`up | down`, null until voted), `voted_at`, `voted_on` (`capture | mesh`). One
    vote per thought; voting again replaces it.
  - `reason_encrypted` (tenant-encrypted like thought text), `reason_kind`;
  - `edit_applied_at`, `created_at`, `updated_at`.
- RLS by `user_id`, like `thought`.
- `parts` holds no user text. Each part is `{ part, ref, engine: 'jev_decision' | 'jev_audit',
  label, probability }`.
  - `ref` is a Jev decision item ref (`m1`, `t2`; the kind name for a whole-capture decision) or an
    audit question id (`name:n1`, `date:d1`, `wording`, `missing_names`, `missing_dates`,
    `piece:p1`, `pieces_cover`). Built this way in C1 (not entity or event ids) so a part cannot point at text.
  - `label` is a closed value: an ontology key, `right`/`wrong`, `none_missing`/`something_missing`.
- Migration note: the parked branch also uses 0083–0085. If it ever comes back, its migrations
  get renumbered. The migrator is hash-based, so the local DB is unaffected.

### 3. Collecting Jev's confidence
Enrichment already receives every enforced decision's outcome in memory (`runEnforced*`). It
passes them to a review builder that writes the `jev_decision` parts at the end of enrichment.
The decision log stays as it is, without thought ids. The review record is the per-capture copy,
in the user's own tenant.

### 4. The audit: Jev checks what the chat model wrote
- **One batched Decisions call per capture**, after enrichment, through the job queue (3 retries;
  the ingest policy). New enforced kind `capture_audit`.
- **Items**, all bounded. The draft criteria get tuned with `jev:check` in C0:
  - Wording, only when the stored text differs from the raw text: does it say the same as what the
    user wrote, without adding, dropping or changing meaning? `right | wrong`
  - Each found name: does the capture really mention this name? `right | wrong`
  - Missing names: does the capture name a person, place, organisation or project that is not in
    this list? `none_missing | something_missing`
  - Each date or time: does the capture say this event is at this time? `right | wrong`. A repeat
    stored as a single date (or a single date stored as a repeat) is `wrong`.
  - Missing dates, always asked: does the capture give a day, time, deadline or repetition that
    Eigen did not store? Words that fix no time ("soon", "more often") do not count. A time that was
    stored wrongly is not missing: the date question judges it. Worded two ways, because Jev read a
    wrongly stored time as missing when the question listed the times: with nothing stored it asks
    whether the capture gives a time for anything; with dates stored it names only their events (no
    times) and asks whether the capture gives one for anything else. `none_missing |
    something_missing`
  - Each split piece: is it one complete thing from the capture, in the user's words? `right | wrong`
  - All pieces together: do they keep everything the capture says? `right | wrong`
- **Cost and failure:** about $0.0002 per capture, in the background, never delaying capture.
  After 3 failures the status is `audit_failed`. It is logged and counted on the operator page,
  never silent. The capture itself stays as stored.

### 5. Score and threshold
- `score` = the lowest probability over the parts **the user sees on the stored thought**: the
  weakest link among those. The scored parts (`SCORED_PARTS`) are the `category` decision and every
  audit part: `wording`, `name`, `missing_names`, `date`, `missing_dates`, `piece`, `pieces_cover`.
  - For the category, that is the probability of Jev's choice.
  - For an audit item, it is P(right) (or P(none_missing)).
  - `entity_type`, `temporal_kind` and `content_role` stay recorded in `parts` for the operator's
    per-part numbers, but never move the score: the user does not see them. A live smoke showed the
    score dominated by such parts (a name typed "artifact" for "train", a time of kind "deadline"),
    a median of 0.59 although everything visible was right.
- `CAPTURE_REVIEW_THRESHOLD = 0.7` is a product constant, like `FORGET_CONFIDENCE_MIN`. It only
  splits the operator's numbers into "weak" and "sure" captures; the user never sees the score.
  It gets recalibrated from 👍/👎 data in C5.

### 6. The vote (two places, never a prompt)
- **Right after capture:** `src/lib/components/capture-kept.svelte`, the status strip that shows
  how the thought was kept (type, thread, background pass, what got linked), gets a small 👍 👎
  pair. It appears once the thought is kept; it does not wait for enrichment or the audit.
- **On Mesh:** `src/lib/components/mesh/thought-inline-editor.svelte`, the unfolded thought row
  that Yarn and threads share, gets the same pair. It shows the current vote, if any.
- **Shared:** one small component for both places. Strings go in paraglide messages, for every
  locale.
- **👍:** verdict `up`, nothing else changes.
- **👎:** a text box, "What was wrong?". On submit:
  1. The text goes to `applyThoughtEditRequest` as the edit request (the existing natural-language
     edit), and the place shows the result as today's edits do.
  2. Jev labels the kind of mistake (`capture_reason`): `wrong_category | wrong_name |
     wrong_link | wrong_date | wording_changed | split_wrong | something_missing |
     not_worth_keeping | other`. Only that label is aggregated.
  - Empty text (decided: D2): only the verdict is stored, with no edit and no label.
  - An edit failure shows an explicit error in place; the verdict stays stored.
- **Thoughts captured before this ships:** they get a review record when they are first voted on.
  The record has the vote and no score; there is no back-fill audit.

### 7. MCP (DoD gate)
- `get_capture_review(thought_id)`: the parts in words, the score and the status.
- `rate_capture(thought_id, verdict, reason?)`: the same as the card. A reason is applied as an
  edit and labelled.
- **Budget:** `capture_thought` → `get_capture_review` → `rate_capture`, at most 3 calls.
- **Cleanup:** `delete_thought` removes the review (cascade).
- **Negative probe:** `verdict: "maybe"` fails loudly with "verdict must be up or down".

### 8. Operator view (aggregates only): `/admin/capture-quality`
- Behind `requireAdmin`.
- **Totals:** captures scored, below threshold, voted (👍, 👎, by place: capture or mesh),
  `audit_failed`.
- **Per part:** how often it was the weakest part, and 👎 rate by confidence band (`<0.5`,
  `0.5–0.7`, `0.7–0.9`, `≥0.9`). This calibration table is what moves the threshold.
- **Reason kinds:** counts.
- Computed by aggregate SQL only. The response holds no text, entity names, thought ids or user
  ids. A test asserts the response shape.

## Acceptance (Given/When/Then)
- **Jev confidence:** given a capture whose category Jev decided at 0.55, when enrichment
  finishes, then its review has a `category` part at 0.55, a score ≤ 0.55, and no user text in
  `parts`.
- **Wording audit:** given a stored wording that adds meaning the user did not write, when
  audited, then the wording part is `wrong` and the score is below the threshold.
- **Date audit:** given "dentist on Friday" stored with Thursday's date, when audited, then that
  date part is `wrong`.
- **Where the vote shows:** given a capture that was just kept, then the strip on Capture shows
  👍 👎. Given the same thought unfolded on Mesh (Yarn or a thread), then the row shows 👍 👎 with
  the current vote.
- **No prompts:** given a capture with a score below the threshold, then nothing asks the user
  about it: no card, no push, no modal.
- **👎 with a reason:** given 👎 with "it's about my sister, not my mom", then the edit is applied,
  `reason_kind` = `wrong_name`, and the operator page counts it without any text.
- **👍, empty 👎, re-vote:** given 👍, then verdict `up` and no edit. Given 👎 with an empty box,
  then verdict `down` with no edit and no label. Given a second vote on the same thought, then it
  replaces the first.
- **Audit failure:** given the audit call failing 3 times, then `audit_failed` is shown on the
  operator page, and the capture is unchanged and visible.
- **German:** a German capture is audited the same way (no string rules anywhere).
- **Operator privacy:** the operator page and its API contain no thought text, reason text,
  entity names, thought ids or user ids.
- **MCP:** `rate_capture` with `verdict: "maybe"` fails loudly with the constraint.

**Tests:**
- **Unit:** parts builder, audit item builder and parser, score, vote endpoint (verdict, re-vote,
  empty reason), reason → edit, reason label, aggregate privacy.
- **Integration:** enrichment with a fake Jev writes the review.
- **E2E:** headed Playwright for the vote in both places (👍; 👎 with a reason → edit; 👎 empty).
- **MCP:** the test drive.

## Phases (each: tests first → build → planner review → commit)
- **C0 — criteria first.**
  - Build a minimal `npm run jev:check`: fixtures of real-shaped example items with expected
    labels, run through the production question builders, with a table of disagreements.
  - Fixtures for `capture_audit` and `capture_reason`, labelled by the planner. The criteria are
    settled here before anything is wired. Cost about 1¢.
- **C1 — record, audit, score (no UI):** migration, review builder in enrichment, audit job,
  score. **Built (2026-10-27).** Code in `src/lib/server/capture-review/`; where it hooks in is in
  [`docs/repo-map/ingestion.md`](../repo-map/ingestion.md). Decisions made while building it:
  - **Recorder.** `recordDecision` lives inside the decision plane (early `content_role`, settled
    `category`, each per-item and bounded answer), so no caller records by hand. Each enrichment
    attempt has its own recorder; a failed attempt's decisions are dropped. Only `REVIEW_DECISION_KINDS`
    (category, content_role, entity_type, temporal_kind) reach the review.
  - **Review write.** After `markEnrichQueueComplete` and the enriched notification, with its own
    ingest retry ladder (3 retries of only the review write and the enqueue, never a re-enrich).
    If it still fails the error goes into the existing catch: the queue row is marked `failed` with
    the message and a user-initiated retry re-enriches and records the review.
  - **Audit job.** `capture_review_audit`, `maxAttempts = 1 + INGEST_MAX_RETRIES` = 4 (first try plus
    3 retries; the queue's own default of 3 tries would be one retry short of the ingest policy). No
    dedupe key: each enrichment queues its own audit, the job ignores a review that is no longer
    `pending_audit`, and its final write only applies while the review still carries the parts it
    started from. A final failure sets `audit_failed` with `audit_error` drawn from a closed set of
    sentences (failing step plus attempt count), never from an error message.
  - **Names** are the `entity_resolution_log.mention_surface` rows (rewritten on every enrichment,
    so they mirror the latest extraction) plus the canonical labels of the project entities the
    thought is linked to (`thought_entity` to a `canonical_entity` of type `project` or a GTD
    project, any link source), distinct by the same trimmed string, surfaces first. A mention
    typed `project` leaves no log row, so the link is what puts the project name in the list.
    Deterministic only: nothing is matched against the capture text. Known gaps: a project the
    capture names but that is not linked (a non-task capture the enrich LLM did not put on a
    thread) is still absent and can raise `something_missing`; a thread the LLM assigned without
    the capture naming it is listed and Jev may call it `wrong`. The root fix would be a
    resolution-log row for project mentions in `entity-graph-sync`; C5 shows whether it matters.
  - **Pieces** come from the parent's `metadata.splitInto` (the multi-task fan-out marker, written
    before the children exist); a child (`metadata.splitFrom`) gets none.
  - **Dates.** `day` is the start day of `active_period` in the event's own time zone. `detail`
    holds the clock time (only for `exact` precision, not all-day), `as the deadline`, the
    repeat (`every Tuesday`) and `until {day}` (only when the text gave an end: the app's own
    one-day or one-hour padding is not described). Recurrence rules: DAILY, WEEKLY, MONTHLY, YEARLY
    with INTERVAL, COUNT, UNTIL, BYDAY and the single month-day forms; anything else fails the audit.
    The `missing_dates` question names only the stored events (`"{event}"`, joined with `; `) and
    no times, or says that no times were stored; the date question alone compares times. A
    clock-time date that enrichment lost ("Dentist on Friday at 9am", nothing stored) shows up as
    `something_missing` and pulls the score down. The first wording (a list of events with their
    computed time phrases) gave 10 false `something_missing` on the live check, because Jev read a
    wrongly stored time as missing.
  - **Repeats and summaries at capture.** The live smoke showed two more extraction errors of the
    same class as the clock-time bug: a repeat ("Yoga every Tuesday at 7pm") stored as one event with
    no rule (the bundle prompt never mentioned `recurrenceRule`), and a `semanticSummary` that was
    just the time ("Friday"), which becomes the audit's event label. The shared temporal element
    contract now lists every field, requires `semanticSummary` (the event, never just the time) and
    a `recurrenceRule` when the capture says the event repeats; the parser rejects a rule the
    formatter cannot read. The date criteria's `wrong` names the repeat mismatch, which Jev had
    passed at 0.95 (fixture `a24-repeat-stored-once`). The criterion alone was not enough (Jev
    still said "right" at 0.72), so the date question's phrase also states a single stored
    occurrence: an item with a `day` ends with `, once (not repeating)` ("for the capture day itself
    at 19:00, once (not repeating)"); repeats and detail-only items get no suffix, and the
    `missing_dates` question is unchanged.
  - **Score** counts only what the user sees (`SCORED_PARTS`, §5), changed after the first live
    smoke: the score was the minimum over all parts, and hidden parts (name types, kinds of time)
    dominated it.
  - **Time zone** is `getUserPreferredTimezone`, the same call enrichment makes for temporal
    extraction (it falls back to `TEMPORAL_ANCHOR_TZ`, then Europe/Berlin, as enrichment does).
  - **Audit logging.** New decision kind `capture_audit` and surface `capture_review`. The ticker only
    drains production tenants, so audits of harness tenants wait until a user drain is run.
  - **Smoke.** `npm run capture-review:smoke` (`evals/capture-review/`, operator-run, live) captures
    the 7 examples of `smoke.json` into the harness tenant `capture-review-smoke` (billed to the
    public-bench operator wallet; the exact id is registered in `harness-billing.ts`), drains the
    enrichment and then the tenant's job queue after each capture, and prints per capture and
    split child the text, category, review status, score, parts and audit input, then totals.
    `--keep` skips the tenant reset. Exit 1 when any review is not `scored`.
- **C2 — the vote:** the shared 👍/👎 component in `capture-kept.svelte` and
  `mesh/thought-inline-editor.svelte`, the vote endpoint, reason → edit, reason label.
- **C3 — MCP tools.**
- **C4 — operator page.**
- **C5 — verification:**
  - Run ~10 made-up captures in a test account, each built to contain one known mistake (wrong
    date, missing name, changed wording, bad split) plus clean ones, and check the scores and the
    vote end to end.
  - The threshold calibration then runs on real 👍/👎 data as it accumulates.

## Decisions (operator, 2026-10-27)
- **No review questions.** The vote is only visible right after capture on the stored thought and
  on the Mesh page. The confirm step at capture already handles doubtful readings. (This replaces
  D1, the check-in slot order.)
- **D2:** 👎 with no text stores the verdict only.
