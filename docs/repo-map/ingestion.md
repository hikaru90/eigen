# Domain: Ingestion

**Canonical rule:** All server-side capture, edit, relink, and list persistence flows go through [`src/lib/server/capture/service.ts`](../../src/lib/server/capture/service.ts). HTTP and MCP are thin adapters.

**Embeddings boundary:** Capture/edit may **write** embeddings to Postgres; `listThoughts` and tool returns must **not** select or expose vector columns. See [embeddings-db-only-boundary.md](../planning/embeddings-db-only-boundary.md).

**Timing / LLM step breakdown:** [ingest-retrieval-timing.md](../planning/ingest-retrieval-timing.md) (`npm run measure:ingest` for a live sample).

## CompetingSystems

- **Runtime graph:** Apache AGE (`AGE_GRAPH_NAME`, default `eigen_graph`) via [`src/lib/server/graph/age.ts`](../../src/lib/server/graph/age.ts). See **C001** (resolved) in [conflicts.md](./conflicts.md).

## Key files (scan-first)

### [`src/lib/server/capture/service.ts`](../../src/lib/server/capture/service.ts)

- **Purpose:** Single orchestration layer for thought capture, edit, relink, and listing after persistence.
- **Owns:** Transactional insert/update of `thought` rows; embedding and lexical text; AGE graph upsert for thought node; relation + entity graph sync hooks; capture activity logging; ontology refresh triggers.
- **DependsOn:** Drizzle `getDb()`, LLM embedding gateway, ontology resolution, AGE graph adapter ([`age.ts`](../../src/lib/server/graph/age.ts)), lexical helper, relation extraction / entity sync modules.
- **PublicSymbols:** `normalizeThoughtText`, `captureThought`, `editStoredThought`, `relinkThoughtGraph`, `deleteThoughtForUser`, `listThoughts`.
- **FailureMode:** Throws or returns `{ ok: false }` for edit when thought missing; no silent fallback for missing LLM or DB.

#### `captureThought(userId, rawInput, options?)`

- **InputContract:** Non-empty trimmed raw string; authenticated `userId`.
- **OutputContract:** Stored thought row subset (id, texts, category, metadata, `queueStatus`, `enrichmentComplete`).
- **SideEffects:** Tier 1 — `queueCapture` inserts row; schedules background enrich worker. Eval harness uses default async enrich and waits at the check step. Pass `awaitEnrichment: true` only for tests that need inline tier 2 on the caller connection.
- **Enrichment lifecycle:** Default capture returns in ~tens of ms after text persist. Background worker claims pending rows FIFO, loads `loadEnrichmentContext`, runs `enrichQueuedThought` in place on the same row. NDJSON streaming emits tier-1 progress only, then `done` (with `queueStatus: pending` when enrich not yet complete). UI may poll until `enrichmentComplete`.
- **Invariants:** One Postgres row per capture; lexical text at insert; tenant is always `userId`.

### Tier 1 — [`queue-capture.ts`](../../src/lib/server/capture/queue-capture.ts)

- **PublicSymbols:** `queueCapture`, `claimNextPendingThought`, `markEnrichQueueComplete`, `markEnrichQueueFailed`.
- **Purpose:** Hot path text-only insert; row is the queue. `capture_session` + `thought` inserts commit in **one transaction**. The AGE `Thought` anchor upsert is **best-effort**: on failure the capture still succeeds and the worker is scheduled — tier-2 enrich always re-ensures the anchor via `entity-graph-sync` (idempotent MERGE). The failure is logged loudly, never swallowed.

### Tier 2 — enrich worker + context

- [`enrichment-context.ts`](../../src/lib/server/capture/enrichment-context.ts) — `loadEnrichmentContext(userId, thoughtId, normalizedText)` bundles ontology, profile, entity hints, recent thoughts, community summaries (tier 3 when available) before any enrich LLM call.
- [`enrich-queued-thought.ts`](../../src/lib/server/capture/enrich-queued-thought.ts) — `enrichQueuedThought`, `processCaptureEnrichQueue`.
- **Decision plane (Jev, shadow + enforced):** enrich kicks the OpenRouter decision model beside the chat judge ([decision-plane.ts](../../src/lib/server/llm/decision-plane.ts)) — one Decisions API call carrying the bounded questions (category, content role, entity type; spec: [09-jev-decision-plane.md](../planning/09-jev-decision-plane.md)). Per kind, either engine can be authoritative: `DECISION_ENFORCE_KINDS` promotes kinds to decision-model authority (promoted 2026-10-15: `category`, `content_role` — see the spec's promotion record); enforced category overrides the bundle's category at persist, and an early pre-split Jev call decides content split (thought_only skips the split chat call entirely, split runs as generation-only via the `decidedMode` contract). Enforced answers fail loud into the ingest retry ladder — no fallback. Every row lands in `decision_shadow_log` with `authoritative_engine` (`chat_judge` | `decision_model`), one row per decision kind, RLS-isolated, metadata-only. Shadow state is env-gated (`DECISION_SHADOW_ENABLED`); enforcement additionally requires it. Ask turns add two whole-question kinds on surface `chat_turn` — `capture_worthy` (yes/no) and `proposal_reply` (confirm/revise/unrelated) — asked in one call per turn on every Ask message regardless of `DECISION_ENFORCE_KINDS` (see [ui-surfaces.md](./ui-surfaces.md) `/chat`); confirmed Ask thoughts enter `captureThought` with source `ask`.
- **Capture review (after enrich; vote UI in C2, see the next bullet; plan: [capture-feedback.md](../planning/capture-feedback.md)):** every thought that finishes `enrichQueuedThought` gets one `capture_review` row (migration `0083`, RLS by `user_id`) holding how sure Eigen is that it stored the capture right. The pipeline is: (1) each enrichment attempt runs inside [`withDecisionRecorder`](../../src/lib/server/capture-review/decision-recorder.ts) (AsyncLocalStorage), and `decision-plane.ts` calls `recordDecision` for every _enforced_ Jev outcome (early `content_role`, settled `category`, each per-item answer such as `entity_type` `m1` / `temporal_kind` `t1`, each bounded answer); a failed attempt's decisions are dropped with it. (2) After `markEnrichQueueComplete` and the enriched notification, [`recordCaptureReview`](../../src/lib/server/capture-review/record-review.ts) upserts the review by `thought_id` (`jev_decision` parts for `REVIEW_DECISION_KINDS` = category, content_role, entity_type, temporal_kind; `status 'pending_audit'`, `score` null; the vote columns are never touched) and enqueues one `capture_review_audit` job (`user_job_queue`, 4 tries = first try + 3 retries, no dedupe key). That step has its own ingest retry ladder; if it still fails the error is thrown into the existing catch, so the queue row is marked `failed` with the message and a user-initiated retry re-enriches and records the review. (3) The job ([`audit-job.ts`](../../src/lib/server/capture-review/audit-job.ts), dispatched in `job-queue/drain.ts`) reads the stored capture ([`audit-input.ts`](../../src/lib/server/capture-review/audit-input.ts): texts, names from `entity_resolution_log.mention_surface` plus the labels of the project entities the thought is linked to (`thought_entity` to a project `canonical_entity`), dates from `temporal_event` via [`temporal-detail.ts`](../../src/lib/server/capture-review/temporal-detail.ts) and [`recurrence.ts`](../../src/lib/server/capture-review/recurrence.ts), pieces from the parent's `metadata.splitInto`), builds the C0 questions ([`audit-questions.ts`](../../src/lib/server/capture-review/audit-questions.ts)), asks Jev once (`runCaptureAudit` in `decision-plane.ts`: Jev-only, not gated by `DECISION_ENFORCE_KINDS`, needs the decision-model config, logs one `decision_shadow_log` row per question with kind `capture_audit` and one `activity_call_log` row), and writes `jev_audit` parts (probability = Jev's P of the good answer) plus `score` = the lowest probability over the parts the user sees (`SCORED_PARTS` in [`review-parts.ts`](../../src/lib/server/capture-review/review-parts.ts): the `category` decision and every audit part; `entity_type`, `temporal_kind` and `content_role` stay in `parts` for the operator but do not count), `status 'scored'`. Besides `missing_names`, the audit always asks `missing_dates` (does the capture give a day, time, deadline or repetition that Eigen did not store? With nothing stored the question asks about the capture alone; with dates stored it names their events, never their times). On the last attempt a failure sets `audit_failed` with a text-free `audit_error`. `parts` never hold user text (strict zod schema, [`review-parts.ts`](../../src/lib/server/capture-review/review-parts.ts)); `CAPTURE_REVIEW_THRESHOLD` (0.7) is for the operator numbers in C4.
- **Capture vote (C2; plan: [capture-feedback.md](../planning/capture-feedback.md) §6):** the owner may press 👍/👎 on a stored thought in two places only (the kept strip on Capture, the unfolded Mesh row; Eigen never asks). [`voteOnCapture`](../../src/lib/server/capture-review/vote.ts) (behind `POST /api/capture/review/vote`, contract in [`vote-input.ts`](../../src/lib/server/capture-review/vote-input.ts), persistence in [`vote-store.ts`](../../src/lib/server/capture-review/vote-store.ts), which writes only the vote columns of `capture_review`): **👍** and **👎 with no text** store `verdict` / `voted_at` / `voted_on` and clear `reason_encrypted` / `reason_kind` (no label, no edit; `edit_applied_at` is left as it is); **👎 with a reason** (trimmed, at most 2000 characters) (1) builds `storedSummary` deterministically from what is stored now ([`stored-summary.ts`](../../src/lib/server/capture-review/stored-summary.ts): `Saved as {category} · about {names} · {event}: {when}; … · split into {n} thoughts`, names, dates and pieces from the audit input, dates via `describeStoredDates`), (2) asks Jev for the kind of mistake (`runCaptureReasonLabel` in `decision-plane.ts`: Jev-only, decision kind `capture_reason`, surface `capture_review`, subject ref `reason`, one `decision_shadow_log` row and one `activity_call_log` row, never any text; run inside `runIngestWithRetries`, so the first try plus exactly 3 retries; a choice outside `CAPTURE_REASON_KINDS` is a failed try), and only if that works (3) creates the review row for a thought that has none (empty `pending_audit` parts + one `capture_review_audit` job, rolled back if the job cannot be queued), (4) routes the reason by the label: `wording_changed` goes through `editStoredThought` (the natural-language edit); the data kinds go to the re-check (`recheck.ts`, below) and never edit the text; `not_worth_keeping` and `other` store the vote only, and (5) stores verdict, tenant-encrypted reason (`table 'capture_review'`, `column 'reason'`), label and `edit_applied_at`. If the label fails after the ladder **nothing** is stored (no review row, no job, no edit) and the call throws `CaptureVoteError('label_failed')` (HTTP 502); if only the edit fails, verdict, reason and label are stored with `edit_applied_at` null and the edit error is returned (HTTP 200 with `editError`). Voting again replaces the vote. Logs carry ids, verdict and kind only. The Mesh loaders attach each row's `verdict` (`loadCaptureVerdicts`; never the reason, kind or score).
- [`capture-enrich-worker.ts`](../../src/lib/server/capture/capture-enrich-worker.ts) — `scheduleCaptureEnrichWorker` (per-user deduped worker).

### Tier 3 — consolidation (overnight + incremental)

Runs on a global nightly cron and via manual heartbeat (“Run now”). Not on the capture hot path.

- [`src/lib/consolidation/heartbeat-job-plan.ts`](../../src/lib/consolidation/heartbeat-job-plan.ts) — ordered jobs: salience, ontology prune, entity dedup/repair, **community_detection**, **community_summaries**, **community_bundles**, retrieval link backfill, thought retrieval features.
- [`incremental-consolidation.ts`](../../src/lib/server/consolidation/incremental-consolidation.ts) — dirty-community refresh after tier-2 enrich (not only nightly).
- **Purpose:** cluster related thoughts, generate short routing summaries + embeddings, precompute `community_bundle` top-thought lists and salience/recency features used at query time. See [retrieval.md](./retrieval.md) § Memory tiers.

### Canonical dedup lifecycle

- Ingest-time dedup still happens in `resolveOrCreateCanonicalEntity` (key/alias/embedding merge decision).
- Nightly consolidation now adds a conservative post-ingest pass (`dedup_canonical_entities`) that merges very-close canonical duplicates and preserves secondary keys as aliases before community detection.

#### `editStoredThought(userId, thoughtId, editRequest, options?)`

- **InputContract:** Existing thought owned by `userId`; non-empty edit request string.
- **OutputContract:** `{ ok: true, thought }` or `{ ok: false, reason: 'not_found' }`.
- **SideEffects:** Updates thought row, re-embeds, updates AGE graph node, re-syncs relations/entities, logs activity.
- **Invariants:** Same as capture for graph/lexical/embedding consistency.

#### `relinkThoughtGraph(userId, thoughtId, options?)`

- **Purpose:** Re-run relation + entity graph sync without changing stored text; clears outgoing AGE graph edges for that thought first (see file docblock).
- **FailureMode:** Missing thought → not found path; errors propagate.

### [`src/lib/server/capture/enrich.ts`](../../src/lib/server/capture/enrich.ts)

- **Purpose:** Async enrichment steps for persisted thoughts (relations, entities, memory type, cues, temporal, link materialization). Tier 2 worker calls `enrichQueuedThought`; edit/relink paths call `enrichThought` / `reenrichThought` directly. The cues step also persists `thought.ask_question` (+ `ask_question_encrypted`): from the single `enrich_thought_bundle` call on capture, or from the one `extractRecallCues` call on re-enrich after an edit (an edit clears the old question first). Temporal mentions come from the same bundle call (or `extractTemporalMentions` on re-enrich) and are parsed by [`parseTemporalMentions`](../../src/lib/server/memory/temporal-normalize.ts) against ONE contract, `TEMPORAL_ELEMENT_CONTRACT` (both prompts embed it and list the element fields nowhere else; it is generated from `TEMPORAL_ELEMENT_FIELDS` and lists every field with whether it is required, plus the allowed `kind` and `timePrecision` values with meanings, e.g. a clock time is `exact`, and what `semanticSummary` is: the event itself, never just the time): an off-catalog `kind`/`timePrecision`, a missing `surface`/`startAt`/`timePrecision`/`timezone`/`semanticSummary` (no fallback to the surface), or a `recurrenceRule` the capture review's RRULE formatter cannot read ([`recurrence.ts`](../../src/lib/server/capture-review/recurrence.ts): DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, COUNT, UNTIL) makes the parse throw with the field and the received value (nothing dropped, nothing defaulted), and so does a bundle without a `temporalMentions` array. A repeat the capture states ("every Tuesday at 7pm") is stored as one event with a `recurrenceRule`. On the queue path that throw evicts the eval-cache entry and the ingest retry ladder re-asks (1 + 3 attempts); the single-shot edit/relink path fails the edit with the same explicit step error.
- **PublicSymbols:** `enrichThought`, `reenrichThought`, `scheduleEnrichThought`, `scheduleReenrichThought`.
- **FailureMode:** `enrichThought` does not throw; per-step failures logged. `scheduleEnrichThought` / `scheduleReenrichThought` remain for legacy edit fire-and-forget; new captures use the enrich worker.

### [`src/routes/api/capture/submit/+server.ts`](../../src/routes/api/capture/submit/+server.ts)

- **Purpose:** Authenticated POST JSON `{ raw }`; optional NDJSON progress stream when `Accept` includes `application/x-ndjson`.
- **Owns:** Request validation, `runWithTrace` wrapper, error JSON shape; NDJSON path reserves a dedicated DB connection for tier-1 queue insert only.
- **PublicSymbols:** `POST` handler.
- **FailureMode:** 401 unauthenticated; 400 bad JSON / missing `raw`; 500 with `{ error, details }` on pipeline failure.

### [`src/routes/api/capture/edit/+server.ts`](../../src/routes/api/capture/edit/+server.ts)

- **Purpose:** POST edits to an existing thought by id + natural-language request; delegates to `editStoredThought`.

### [`src/routes/api/capture/review/vote/+server.ts`](../../src/routes/api/capture/review/vote/+server.ts)

- **Purpose:** POST the owner's 👍/👎 on a stored thought: `{ thoughtId, verdict: 'up'|'down', place: 'capture'|'mesh', reason? }` → `voteOnCapture`. A reason is applied as an edit and labelled by Jev (see the Capture vote bullet above).
- **InputContract:** exact messages, checked before any work: `thoughtId must be a uuid`, `verdict must be up or down`, `place must be capture or mesh`, `reason must be a string`, `reason must be at most 2000 characters`, `reason is only allowed with verdict down`.
- **Output:** `{ verdict, reasonKind, editApplied, editError, thought }` (`thought` is the edited thought as `/api/capture/edit` returns it, only when an edit ran).
- **FailureMode:** 401 no user; 400 bad vote; 404 no such thought; 502 the label could not be made (nothing stored); 500 anything else (message returned, ids only logged).

### [`src/routes/api/capture/relink/+server.ts`](../../src/routes/api/capture/relink/+server.ts)

- **Purpose:** POST relink-only graph refresh for a thought id.

### [`src/lib/server/mcp/tools.ts`](../../src/lib/server/mcp/tools.ts)

- **Purpose:** MCP tool runners; `runCaptureThoughtTool`, `runEditThoughtTool`, and `runListThoughtsTool` call `capture/service` (retrieval tools live in retrieval domain).
- **Capture review tools (C3; plan: [capture-feedback.md](../planning/capture-feedback.md) §7):** [`capture-review-tools.ts`](../../src/lib/server/mcp/capture-review-tools.ts) holds `get_capture_review` (status, score against the 0.7 threshold, parts in words, the vote; built by [`review-view.ts`](../../src/lib/server/capture-review/review-view.ts) from `loadCaptureReviewSnapshot` in `review-store.ts` and the C1 audit input; never the reason, embeddings or another user's data) and `rate_capture` (`voteOnCapture` with place `mcp`, which `saveCaptureVote` stores as `voted_on` NULL, in one place: `votedOnColumn`). Both are HTTP MCP only: the registry flag `exposeInChat: false` keeps a definition out of the in-app Ask/chat agent (the one mechanism; it also keeps out `capture_thought` and the board tools). Arguments are strict (`strictToolArgs` in `validation/mcp-args.ts`, shared with the board and Ask proposal tools). Agent test-drive: [agent-benchmark.md](../testing/agent-benchmark.md).
- **Capture quality (C4; plan: [capture-feedback.md](../planning/capture-feedback.md) §8):** `/admin/capture-quality` (admin layout `requireAdmin`; `?harness=1` includes harness accounts) shows aggregates of `capture_review` across tenants: [`loadCaptureQuality`](../../src/lib/server/capture-review/admin-quality.ts) runs aggregate SQL on the admin pool and returns counts only (no text, names or ids), parsed with a strict zod schema. `score` (float4) is compared with real-cast bounds; the weakest part is computed from the `parts` jsonb probabilities. The page derives thumbs-down rates (`lib/utils/capture-quality-rates.ts`).
- **Vote re-check (C5 follow-up; plan: [capture-feedback.md](../planning/capture-feedback.md)):** [`recheck.ts`](../../src/lib/server/capture-review/recheck.ts) holds `snapshotStoredData` (what a vote's edit or re-check can change, compared as one string) and `recheckStoredData`; `voteOnCapture` calls them. For a 👎 reason whose Jev label is in [`recheck-kinds.ts`](../../src/lib/server/capture-review/recheck-kinds.ts), the thought is re-enriched with `ownerCorrection` (LLM prompt context only, [`owner-correction.ts`](../../src/lib/server/capture/owner-correction.ts), threaded `EnrichThoughtOptions` -> `syncEntityGraphFromThought` / `syncTemporalEventsFromThought` -> the extraction prompts) inside the decision recorder, and `recordCaptureReview` rebuilds the review. `split_wrong` runs `redoCaptureSplit` in `memory/split-multi-task.ts` (untouched old children archived, new split from the judge with the correction). `edit_applied_at` and the result's `changed` are set only when the snapshot differs.
- **Capture review verification (C5; plan: [capture-feedback.md](../planning/capture-feedback.md)):** `npm run capture-review:verify` (`evals/capture-review/verify.ts` -> `run-verify.ts`, operator-run, live) captures made-up cases into the harness tenant `capture-review-verify` (exact id in `harness-billing.ts`, billed to the public-bench wallet), injects known mistakes into the stored data the audit reads (`verify-inject.ts`: `temporal_event`, `entity_resolution_log`, normalized text, `metadata.splitInto`, through the operator connection), re-runs `runCaptureReviewAudit` directly, then casts votes through `voteOnCapture` and compares `loadCaptureQuality` before and after. Pure parts (cases, mutation descriptors, judge, report) are unit-tested in `evals/capture-review/verify-*.spec.ts`.
- **Note:** MCP HTTP registration lives in [`registry.ts`](../../src/lib/server/mcp/registry.ts) (`capture_thought`, `retrieve_thoughts`, `edit_thought`, `delete_thought`, `get_capture_review`, `rate_capture`, project tools including `list_projects`, `get_project_timeline`, `order_task_in_project`, `set_project_milestone`, `set_project_deadline`, `generate_project_plan`). **C002** resolved — see [conflicts.md](./conflicts.md).

### Client capture queue (browser)

- **Canonical doc:** [capture-queue.md](./capture-queue.md) — enqueue on `/capture`, serial drain, per-item remove, NDJSON progress, offline Background Sync.
- **Code:** [`src/lib/capture/queue/`](../../src/lib/capture/queue/), [`src/routes/capture/+page.svelte`](../../src/routes/capture/+page.svelte), [`src/lib/components/capture-queue-list.svelte`](../../src/lib/components/capture-queue-list.svelte), [`src/lib/components/ingest-phase-indicator.svelte`](../../src/lib/components/ingest-phase-indicator.svelte).

### [`src/lib/capture/ingest-phases.ts`](../../src/lib/capture/ingest-phases.ts) and [`src/lib/capture/consume-capture-ndjson.ts`](../../src/lib/capture/consume-capture-ndjson.ts)

- **Purpose:** Shared phase typing and NDJSON stream consumer (used by the queue submitter and by **edit** on the capture page).

### [`src/routes/capture/+page.svelte`](../../src/routes/capture/+page.svelte)

- **Purpose:** Primary capture UI. **New UI submits** go through the confirmation gate: `POST /api/capture/interpret` → if the LLM sets `deviatesFromVerbatim`, a **modal** with 5s auto-accept (`POST /api/capture/confirm`, or `{ verbatim: true }` on Dismiss); if not, the server auto-ingests. Enrich runs only after ingest/confirm/dismiss. Offline IndexedDB queue may still drain to `/api/capture/submit` for backlog. **Edits** to an already stored thought still `fetch` `/api/capture/edit` with NDJSON progress. See [capture-queue.md](./capture-queue.md).

### Confirmation gate

- **Orchestration:** [`src/lib/server/capture/capture-confirmation.ts`](../../src/lib/server/capture/capture-confirmation.ts) — `interpretAndQueueCapture`, `confirmCapturePreview` (optional `verbatim`), `autoConfirmStaleAwaitingConfirmationDrafts`.
- **LLM interpret:** [`src/lib/server/capture/interpret-thought.ts`](../../src/lib/server/capture/interpret-thought.ts) — preview bundle `{ interpretedText, category, memoryType, entities, deviatesFromVerbatim }`.
- **HTTP:** `/api/capture/interpret`, `/api/capture/confirm`.
- **Queue status:** `awaiting_confirmation` on deviation drafts; confirm/dismiss/timeout (or stranded >5s sync) promotes to `pending` and schedules the enrich worker. UI: confirmation modal (not a dead list badge alone).
- **Invariant:** `raw_text` never overwritten by interpret/confirm; only `normalized_text` / lexical / category / memoryType update on confirm (Dismiss sets `normalized_text` = raw).

### Notes (text files)

- **Purpose:** First-class Keep-style documents stored in `text_file` — shopping lists, notebooks, checklists, pasted reference. **Not** thoughts: no enrich queue, embedding, or graph pipeline. UI: [`/memory/notes`](../../src/routes/memory/notes/+page.svelte).
- **Optional thought links:** Capture may auto-split reference material into a linked note during enrich; Capture UI “Attach note” and chat tools `link_text_file_to_thought` / `unlink_text_file_from_thought` for manual linking. Join table: `thought_text_file` (deleting a thought removes links only; notes remain in the library).
- **Automatic split on enrich:** During background enrich, an LLM judge (`split-capture-content.ts`) partitions capture input when appropriate. **Verbatim invariant:** `thought.raw_text` is the user’s submitted text and is **never** overwritten by content-split (only an explicit edit may change it). `thought_only` (tasks, bug reports, ordinary notes) keeps `normalized_text` as whitespace-normalized original — no LLM paraphrase. `split` may distill a short pointer onto `normalized_text` and store reference material (recipes, templates, procedures, transcripts, pasted bodies) as a linked **text note**; the full original remains on `raw_text`. Captures longer than `LONG_CAPTURE_MIN_CHARS` (500) are **always** split — the LLM writes a short summary thought and the full text becomes the linked note (`captureSplitMode`, overriding a `thought_only` decision); shorter captures are split by **content role**, not length.
- **Service:** [`src/lib/server/text-files/service.ts`](../../src/lib/server/text-files/service.ts) — CRUD plus `appendTextFile` (deterministic body concat for list/checklist edits).
- **Chat agent tools** (in-app only; `exposeInMcp: false` — **not** on HTTP MCP): `create_text_file`, `list_text_files`, `get_text_file`, `update_text_file`, `append_text_file`, `delete_text_file`, `search_text_files`, `link_text_file_to_thought`, `unlink_text_file_from_thought`. HTTP MCP remains the four thought tools only.
- **Agent contract:** Create a **new** note with `create_text_file`. Additive edits on a referenced note/list (e.g. “add milk to my shopping list”) must `search_text_files` / `list_text_files` → `append_text_file` (or get + full `update_text_file`). Never `create_text_file` for additive requests; never `capture_thought` for Notes documents. See [`agent-loop.ts`](../../src/lib/server/llm/agent-loop.ts).
- **Retrieval:** Lexical keyword search via `searchTextFiles` / `search_text_files` and `retrieve_thoughts` (`textFiles` hits). Included in `composeAnswer` context (no embeddings on `text_file`). Full body via `get_text_file`.

## Related but not canonical for “ingest contract”

- Schema definitions: [`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts) (and brain tables).
- Ontology: [`src/lib/server/ontology.ts`](../../src/lib/server/ontology.ts), [`src/lib/server/ontology-db.ts`](../../src/lib/server/ontology-db.ts).
