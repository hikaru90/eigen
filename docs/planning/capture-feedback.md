# Capture feedback: did Eigen store this right?

Status: **draft for the operator (2026-10-27)**. C0 (criteria and `npm run jev:check`), C1
(record, audit, score; no UI), C2 (the vote), C3 (MCP tools), C4 (operator page) and C5 (verification run) are built. It builds on `main` *after* the
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
  - `verdict` (`up | down`, null until voted), `voted_at`, `voted_on` (`capture | mesh`, or
    NULL for a vote cast by an agent over MCP; C3, no migration: the column was nullable). One
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
- `get_capture_review(thought_id)`: the status (`none | pending_audit | scored | audit_failed`),
  the score against the 0.7 threshold, every part in words and the vote. Details under C3.
- `rate_capture(thought_id, verdict, reason?)`: the same as the card. A reason is applied as an
  edit and labelled.
- **Budget:** `capture_thought` → `get_capture_review` → `rate_capture`, 3 calls.
- **Cleanup:** `delete_thought` archives the thought (soft-remove). The review row stays with it
  (it is only removed by a hard delete, through the foreign key's cascade), and
  `get_capture_review` on an archived thought still answers, with a note saying so.
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
  **Built (2026-10-27).** Code: `src/lib/server/capture-review/vote*.ts`, `stored-summary.ts`,
  `src/routes/api/capture/review/vote/`, `src/lib/components/capture-vote.svelte`; where it hooks in
  is in [`docs/repo-map/ingestion.md`](../repo-map/ingestion.md) and
  [`ui-surfaces.md`](../repo-map/ui-surfaces.md). Decisions made while building it:
  - **Order of a 👎 with a reason.** Stored summary (read before the edit) → Jev label (ingest
    ladder, first try + 3 retries) → encrypt the reason → create the review row if the thought has
    none (and queue its audit job) → apply the reason as an edit → store the vote. The label
    comes first and the review row second, so a label that cannot be made stores nothing at all:
    no review, no job, no edit. A review created for an old thought is removed again if its job
    cannot be queued, so a retry finds the thought as it was.
  - **Edit failure** does not undo the vote: verdict, encrypted reason and label are stored with
    `edit_applied_at` null, and the answer is a 200 with `editError` (the UI shows it in place and
    keeps the typed text). Label failure is a 502 and stores nothing (the UI keeps the text too).
  - **Contract.** `reason` with a 👍 is a 400 (`reason is only allowed with verdict down`): a 👍
    applies nothing, so a reason would be silently dropped. An empty or blank reason on a 👎 means
    "no reason". The reason is trimmed; more than 2000 characters is a 400.
  - **Stored summary** is `Saved as {category} · about {names} · {event}: {when}; … · split into
    {n} thoughts` from the C1 audit input, the dates through `describeStoredDates` (the date
    question's own phrase: a distance from the capture day, `once (not repeating)` for a single
    date). The category is the key prettified the way the kept strip shows it.
  - **What the edit result updates.** The edit's thought (`CaptureSubmitResult`) carries the words
    and category, not a thread id, so a host takes words and type and keeps its thread: the Mesh
    row gets `{ text, category, thread (as it was) }` like an "Edit words" save, the kept strip gets
    `{ typeKey, thread (as it was) }`.
  - **Where the vote shows.** The strip: below the progress line, from the moment the thought has an
    id (it does not wait for enrichment or the audit). Mesh: in the unfolded row's pill line, after
    the "Edit words" pill; its reason box takes its own full-width line like the words editor. The
    loaders add `verdict` only: `loadYarnThoughts` (Yarn, thread detail and `GET /api/mesh/yarn`) and
    the Loose ends load.
  - **Tests.** Unit and component specs for every piece above (the component specs are in the
    `test:components` merge gate). Headed E2E, nothing mocked:
    [`src/routes/e2e/capture-vote.e2e.ts`](../../src/routes/e2e/capture-vote.e2e.ts) (👍 in the
    strip; the Yarn row shows 👍; 👎 with a reason edits the row; the vote survives a reload; an
    empty 👎 stores the verdict only; `verdict: "maybe"` is a 400). Written, not yet run: it needs
    the local stack and the decision model.
  - **Known gap (C1).** `editStoredThought` re-enriches through `enrichThought`, which does not run
    the capture review recorder (only the queued enrichment does), so an edit made by a 👎 reason
    does not reset the review's parts or queue a new audit: the score keeps describing the text
    before the edit. The vote columns are independent of that.
- **C3 — MCP tools.** **Built (2026-10-27).** Code: `src/lib/server/mcp/capture-review-tools.ts`
  (the two tools), `src/lib/server/capture-review/review-view.ts` (the view), the registry entries
  in `src/lib/server/mcp/registry.ts`; where it hooks in is in
  [`docs/repo-map/ingestion.md`](../repo-map/ingestion.md). The test-drive is in
  [`docs/testing/agent-benchmark.md`](../testing/agent-benchmark.md). Decisions made while
  building it:
  - **`get_capture_review { thought_id }`** answers `{ thought_id, status, score, threshold: 0.7,
    below_threshold, parts, vote, note }`. `status` is `none` when the thought has no review row
    (not an error; the note says enrichment may still be running or the thought predates reviews,
    and that rating it starts its review). `below_threshold` is null without a score, and a score
    at the threshold is not below it. `parts` lists every stored part in its stored order as
    `{ part, ref, label, probability, counts_toward_score, about }`; `counts_toward_score` is
    `SCORED_PARTS` membership, so the hidden decisions (entity type, kind of time, content role)
    are listed but flagged. `vote` is `{ verdict, voted_on, reason_kind, edit_applied }` or null;
    it never carries the reason text (the read does not select it, encrypted or not). Embeddings
    never appear (`sanitizeMcpToolResult`, like every tool).
  - **`about`** is built from the thought as it is stored now, through the C1 audit input and no
    model: a name is its surface, a date is `"{event}" — {the date question's phrase}` (from the
    new `describeStoredDatePhrases`, the pieces `describeStoredDates` joins), a piece is its text,
    the category is the thought's current category key. Whole-capture parts (wording, missing
    names or dates, pieces cover, content role) and the hidden decisions (entity type, kind of time;
    their refs index the enrichment's mentions and times, which are not stored) have `about` null,
    and so has a name, date or piece whose ref no longer points at anything.
  - **Notes** (`note`, joined with one space when more than one applies, otherwise null): `none`;
    `pending_audit` (the audit has not finished, no score, the audited parts are not listed yet);
    `audit_failed` (it gave up, with the stored closed sentence; the thought is stored as it is);
    "The parts describe the capture before its latest edit." when `edit_applied_at` is after the
    review's `updated_at`; and an archived thought keeps its review.
  - **`updated_at` now means "the last write of the audit columns".** `saveCaptureVote` no longer
    bumps it (a vote used to set it after `edit_applied_at`, which would have made the stale-parts
    note impossible to trigger). Only an edit applied through a 👎 reason is detected; an edit
    through `edit_thought` or the Mesh "Edit words" is not recorded on the review, so the note
    stays null there (the known gap of C2 stands).
  - **`rate_capture { thought_id, verdict, reason? }`** is `voteOnCapture` with place `mcp`, with
    the same semantics as the card: 👍 stores the verdict; 👎 without a reason stores the verdict;
    👎 with a reason is labelled by Jev, applied as an edit and stored encrypted. It answers
    `{ verdict, reason_kind, edit_applied, edit_error, thought }`, with `thought` (the edit result,
    the shape `edit_thought` returns) only when an edit ran. A label that cannot be made fails the
    call and stores nothing (as in the app).
  - **Place.** `CaptureVotePlace` is `capture | mesh | mcp`; `voteOnCapture` accepts all three and
    `saveCaptureVote` is the one place that maps `mcp` to NULL (`votedOnColumn`). `voted_on` NULL
    therefore means "via an agent/MCP"; the HTTP vote endpoint still accepts only `capture` and
    `mesh`. No migration (the column was nullable and its check constraint allows NULL).
  - **Errors, exact and before any DB or Jev work:** `Arguments must be a JSON object`;
    `Unknown argument: {key}. Allowed: …` (strict keys, no `thoughtId` or `id` aliases);
    `thought_id must be a uuid`; `verdict must be up or down`; `reason must be a string`;
    `reason must be at most 2000 characters`; `reason is only allowed with verdict down`. After
    that: `Thought not found` (unknown, or another user's) and the label-failed sentence.
  - **Exposure.** Both tools are in `MCP_CLIENT_TOOL_NAMES` (HTTP MCP) and carry
    `exposeInChat: false`, the registry flag that keeps a definition out of the in-app Ask/chat
    agent. The flag replaced the earlier name-based exclusions (`capture_thought`, the board
    tools), so there is one mechanism. The operator decided the vote in the app lives only in the
    Capture strip and the Mesh row.
  - **Tests.** Unit specs for the arguments, the shapes, the `about` builder per part kind, every
    status note, the `mcp` mapping and the exposure; the agent test-drive
    (`capture-review-test-drive.spec.ts`: a real MCP client and server over an in-memory transport,
    fakes for the stores, the job queue and Jev, no network).
- **C4 — operator page. Built.**
  - `/admin/capture-quality` (behind the admin layout's `requireAdmin`; `?harness=1` includes harness
    accounts, like spend and queue). Counts only: totals (status, weak/sure against the threshold,
    votes by place with MCP = `voted_on` NULL, votes on unscored reviews, thumbs down without a
    reason), the score-band calibration table, per part kind the weakest count and the bands, and
    the reason kinds. The page derives the thumbs-down rates and always shows n.
  - Server: `capture-review/admin-quality.ts` (`loadCaptureQuality`) reads all tenants with
    `createAdminSql` and aggregate SQL only: no text, names or ids are selected. Kind lists are bound
    from the TS constants. The result is parsed with a strict zod schema, so an unknown status, part
    kind or reason kind throws.
  - **float4 note:** `score` is a `real`, the part probabilities in `parts` are float8. The score
    is compared with real-cast bounds (`${0.7}::real`), or a stored 0.7 would count as below 0.7.
    "Weakest" is computed from the jsonb probabilities only, never against `score`.
  - Tests: an integration spec on delta counts (exact 0.7, ties, several names, unscored kinds,
    harness exclusion, a privacy check on the JSON), a page-load spec, a rate-helper spec.
- **C5 — verification. Built (2026-10-27), first result below.**
  - Run ~10 made-up captures in a test account, each built to contain one known mistake (wrong
    date, missing name, changed wording, bad split) plus clean ones, and check the scores and the
    vote end to end.
  - The threshold calibration then runs on real 👍/👎 data as it accumulates.
  - **How to run:** `npm run capture-review:verify [-- --keep]` (operator-run, live, a few cents;
    needs the same environment as the smoke). Harness tenant `capture-review-verify`, reset by
    default. Code in `evals/capture-review/` (`verify.ts`, `run-verify.ts`, `verify-*.ts`), cases
    in `verify-cases.json` (12 made-up captures, 2 German). Exit 1 when a case, a vote check or an
    operator delta fails; the full table is always printed.
  - **What it covers.** Per case: capture with `captureThought` (`awaitEnrichment`), drain the
    tenant queue, audit directly if still `pending_audit`, record parts and score. Mistake cases
    then inject ONE generic mutation into the stored data at the source the audit reads, reset the
    review to `pending_audit`, re-run `runCaptureReviewAudit` (same function the job calls) and
    record parts and score again. Mutations: `shift_date` (+1 day on the one stored event),
    `shift_time` (+3 h), `delete_dates`, `add_name` (a surface not in the capture, into
    `entity_resolution_log`), `remove_name` (the name Jev rated surest in the clean audit),
    `replace_wording` (normalized text, encrypted form too), `fragment_piece` (first half of the
    words of one `metadata.splitInto` piece), `drop_last_piece`. No code branches on a capture's text.
  - **PASS rule.** Mistake case: the targeted part has the negative label (`wrong` /
    `something_missing`) AND the score is below `CAPTURE_REVIEW_THRESHOLD`. Clean case: score at or
    above it. Other parts that changed label are reported, not failed; a mistake case already below
    the threshold before the injection is flagged. Votes go through `voteOnCapture`: 👍 (place
    `capture`), 👎 empty (`mesh`: verdict only), 👎 with a reason (`mesh`: `reason_kind` and
    `edit_applied_at`), a re-vote. Operator counts (`loadCaptureQuality({ includeHarness: true })`
    before and after) must move by exactly the votes' deltas, and the result must hold no capture text.
  - **Latest result (third real run, 2026-10-27, $0.038).** Mistake cases: the targeted part was
    negative and the score below 0.7 in 7 of 8 cases (rows below); the 4 clean cases all scored
    below 0.7. Votes and operator deltas: all checks pass.

    | case | mutation | before (score, weakest) | after score | target part, label, P(right) | result |
    | --- | --- | --- | --- | --- | --- |
    | clean_weekday_en | - | 0.64 name:n1 | - | - | FAIL (below 0.7) |
    | clean_person_place_en | - | 0.47 category | - | - | FAIL (below 0.7) |
    | clean_split_en | - | 0.67 name:n2 | - | - | FAIL (below 0.7) |
    | clean_weekday_de | - | 0.68 date:d1 | - | - | FAIL (below 0.7) |
    | wrong_date_en | date +1 day | 0.56 category | 0.02 | date:d1 wrong 0.02 | PASS |
    | wrong_time_en | time +3 h | 0.71 name:n1 | 0.02 | date:d1 wrong 0.02 | PASS |
    | missing_date_en | dates deleted | 0.23 date:d1 | 0.01 | missing_dates something_missing 0.01 | PASS |
    | invented_name_en | name invented | 0.48 missing_dates | 0.00 | name:n3 wrong 0.00 | PASS |
    | missing_name_en | name removed | 0.70 name:n1 | 0.01 | missing_names something_missing 0.01 | PASS |
    | changed_wording_de | wording changed | 0.61 category | 0.00 | wording wrong 0.00 | PASS |
    | bad_piece_en | piece 2 cut | 0.62 missing_dates | 0.44 | piece:p2 right 0.68 | FAIL (piece stayed right; pieces_cover went wrong 0.44) |
    | lost_piece_en | last piece dropped | 0.07 date:d1 | 0.00 | pieces_cover wrong 0.00 | PASS |

  - **Follow-up: the 👎 reason re-checks the stored data (2026-10-28).** Run 3 showed a 👎 "wrong day,
    I said Friday" labelled `wrong_date` and marked as applied while the stored date stayed one day
    late: the edit LLM returned the same text, `editStoredThought` took its metadata-only branch and
    nothing re-read dates, names or pieces. Now (`vote.ts`, `recheck.ts`):
    - After the label, the reason goes through `editStoredThought` as before, except for
      `split_wrong` (below). A snapshot of the stored data (`snapshotStoredData`: raw and stored text,
      category, lifecycle status, names, the dates' day and clock detail, pieces, and the split
      family with the children's status) is taken before and after.
    - If the edit changed nothing and Jev's label is about stored data (`wrong_date`, `wrong_name`,
      `wrong_link`, `split_wrong`, `something_missing`, `wrong_category`; `recheck-kinds.ts`), the
      thought is read again with the owner's correction. `ownerCorrection` is an option of
      `reenrichThought` / `enrichThought`; it enters the standalone entity extraction prompt
      (`extractEntityGraphBundle`) and the temporal extraction prompt (`extractTemporalMentions`) as
      "The owner said the last reading of this thought was wrong: "<reason>". Read the thought again
      with that in mind." (`owner-correction.ts`). It is LLM context only: never stored, only its
      length is logged. The queued-enrichment bundle prompt does not take it (the re-check does not use
      the bundle). The re-check runs inside `withDecisionRecorder` and `recordCaptureReview` rebuilds
      the review (capture-time category / content role carry over), which also closes the "score not
      recomputed after a 👎 edit" gap for these kinds.
    - `wrong_category` re-reads the thought too, but `reenrichThought` does not decide the category
      again (that is done at capture by the decision plane), so it rarely changes anything.
    - `split_wrong` does not apply the reason as an edit of the voted thought (the vote may be on one
      child; rewriting it only corrupts it). `redoCaptureSplit` (`split-multi-task.ts`) redoes the
      split of the parent (the voted thought, or the parent its `metadata.splitFrom` names): the split
      judge gets the correction, and only after it answered are the untouched old children archived
      through the lifecycle (never deleted), the parent's `splitInto` replaced (removed when the judge
      now sees one thought) and the new children created like the first fan-out. Children are found by
      the parent's own `created_at` (the fan-out gives them that time) plus `metadata.splitFrom`. A
      child counts as edited, and is left alone, when it is not open, carries `metadata.lastEditRequest`
      (stamped by every natural-language edit and lifecycle change) or its raw text is no longer one of
      the parent's recorded pieces. The parent's review is queued for a new audit.
    - `edit_applied_at` is set only when the snapshot differs; the result (endpoint, MCP
      `rate_capture`) carries `changed`; the vote UI says "Saved your vote. Nothing changed in what was
      stored." when a reason was sent and nothing changed. A re-check that fails after the ingest
      ladder keeps the vote and returns the error (`editError`) with `edit_applied_at` null.
    - Verify now asserts the wrong-date vote restores the captured day (it did), a reason that
      changes nothing leaves `edit_applied_at` null, and a `split_wrong` vote archives the old children.
      Second real run of the follow-up: wrong-date restored; split_wrong archived the three old
      children (confirmed in the rows) and left the capture as one thought; the "changes nothing" vote
      did not test that (the edit LLM rewrote "Am Samstag" to "Diesen Samstag", a real text change that
      also made the capture split in two), so its reason was reworded and is untested.
  - **Findings for the planner (not fixed here):** every clean capture scored below the threshold
    before any injection (weakest: a name rated right at 0.64-0.67, a category at 0.47, a date at
    0.68), most mistake cases were already weak before their injection, a fragment piece
    ("return the drill") was rated right at 0.68-0.72, and the 👎 reason "wrong day, I said Friday"
    was labelled `wrong_date` and applied as an edit but did not restore the captured date (stored
    day stayed one day late). Calibration data and diagnosis belong to the planner.

## Decisions (operator, 2026-10-27)
- **No review questions.** The vote is only visible right after capture on the stored thought and
  on the Mesh page. The confirm step at capture already handles doubtful readings. (This replaces
  D1, the check-in slot order.)
- **D2:** 👎 with no text stores the verdict only.
