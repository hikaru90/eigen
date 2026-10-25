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
- **Decision plane (Jev, shadow + enforced):** enrich kicks the OpenRouter decision model beside the chat judge ([decision-plane.ts](../../src/lib/server/llm/decision-plane.ts)) — one Decisions API call carrying the bounded questions (category, content role (personal | reference | mixed), entity type; spec: [09-jev-decision-plane.md](../planning/09-jev-decision-plane.md)). Per kind, either engine can be authoritative: `DECISION_ENFORCE_KINDS` promotes kinds to decision-model authority (promoted 2026-10-15: `category`, `content_role` — see the spec's promotion record); enforced category overrides the bundle's category at persist, and an early pre-split Jev call decides the content role (once per capture — span children and retried attempts skip it; the generation call runs for the decided role only via the `decidedRole` contract, see Notes below). Enforced answers fail loud into the ingest retry ladder — no fallback. Every row lands in `decision_shadow_log` with `authoritative_engine` (`chat_judge` | `decision_model`), one row per decision kind, RLS-isolated, metadata-only. Shadow state is env-gated (`DECISION_SHADOW_ENABLED`); enforcement additionally requires it.
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

- **Purpose:** Async enrichment steps for persisted thoughts (relations, entities, memory type, cues, temporal, link materialization). Tier 2 worker calls `enrichQueuedThought`; edit/relink paths call `enrichThought` / `reenrichThought` directly. The cues step also persists `thought.ask_question` (+ `ask_question_encrypted`): from the single `enrich_thought_bundle` call on capture, or from the one `extractRecallCues` call on re-enrich after an edit (an edit clears the old question first).
- **PublicSymbols:** `enrichThought`, `reenrichThought`, `scheduleEnrichThought`, `scheduleReenrichThought`.
- **FailureMode:** `enrichThought` does not throw; per-step failures logged. `scheduleEnrichThought` / `scheduleReenrichThought` remain for legacy edit fire-and-forget; new captures use the enrich worker.

### [`src/routes/api/capture/submit/+server.ts`](../../src/routes/api/capture/submit/+server.ts)

- **Purpose:** Authenticated POST JSON `{ raw }`; optional NDJSON progress stream when `Accept` includes `application/x-ndjson`.
- **Owns:** Request validation, `runWithTrace` wrapper, error JSON shape; NDJSON path reserves a dedicated DB connection for tier-1 queue insert only.
- **PublicSymbols:** `POST` handler.
- **FailureMode:** 401 unauthenticated; 400 bad JSON / missing `raw`; 500 with `{ error, details }` on pipeline failure.

### [`src/routes/api/capture/edit/+server.ts`](../../src/routes/api/capture/edit/+server.ts)

- **Purpose:** POST edits to an existing thought by id + natural-language request; delegates to `editStoredThought`.

### [`src/routes/api/capture/relink/+server.ts`](../../src/routes/api/capture/relink/+server.ts)

- **Purpose:** POST relink-only graph refresh for a thought id.

### [`src/lib/server/mcp/tools.ts`](../../src/lib/server/mcp/tools.ts)

- **Purpose:** MCP tool runners; `runCaptureThoughtTool`, `runEditThoughtTool`, and `runListThoughtsTool` call `capture/service` (retrieval tools live in retrieval domain).
- **Note:** MCP HTTP registration lives in [`registry.ts`](../../src/lib/server/mcp/registry.ts) (`capture_thought`, `retrieve_thoughts`, `edit_thought`, `delete_thought`, project tools including `list_projects`, `get_project_timeline`, `order_task_in_project`, `set_project_milestone`, `set_project_deadline`, `generate_project_plan`). **C002** resolved — see [conflicts.md](./conflicts.md).

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

- **Purpose:** First-class Keep-style documents stored in `text_file` — shopping lists, notebooks, checklists, pasted reference. **Not** thoughts: no enrich queue, category, or graph pipeline — the body never feeds the graph. Notes are searchable by meaning through their **passages** (`note_passage`, below). UI: [`/memory/notes`](../../src/routes/memory/notes/+page.svelte).
- **Optional thought links:** Capture may auto-split reference material into a linked note during enrich; Capture UI “Attach note” and chat tools `link_text_file_to_thought` / `unlink_text_file_from_thought` for manual linking. Join table: `thought_text_file` (deleting a thought removes links only; notes remain in the library).
- **Content role on enrich (long-text memory L1–L6):** Jev decides how a capture is stored **by meaning, never by length** — `content_role` ∈ `personal | reference | mixed` ([`content-role.ts`](../../src/lib/server/capture/content-role.ts); criteria in [`decision-plane.ts`](../../src/lib/server/llm/decision-plane.ts); ~300 chars is guidance in the criteria text, not a rule in code — the old `LONG_CAPTURE_MIN_CHARS` forced split is deleted). Any other answer throws into the ingest retry ladder. [`split-capture-content.ts`](../../src/lib/server/capture/split-capture-content.ts) then **generates** for the decided role (the chat call never re-decides), and [`apply-capture-content-split.ts`](../../src/lib/server/capture/apply-capture-content-split.ts) applies it. **Verbatim invariant:** `thought.raw_text` is the user’s submitted text and is **never** overwritten (it stays the audit record of the whole capture).
  - `personal`: the LLM cuts the raw text into **verbatim spans** (one per distinct thing) and only chooses cut points. Code validates, nothing more: each span is an exact substring (trimmed), in text order, non-overlapping, ≤ 10 spans, and together they cover the whole text (only whitespace may be uncovered). One span (a short capture) = nothing changes: the thought keeps the capture text. Several spans: **span 1 stays on the capture’s own thought** (`normalized_text` narrows to it) and spans 2..n become **child thoughts** via the shared fan-out step `queueSplitChild` ([`queue-split-child.ts`](../../src/lib/server/capture/queue-split-child.ts), also used by the multi-to-do fan-out): the parent’s author, the parent’s capture time, `metadata.splitFrom`. Every span lives in exactly one active thought — no summary-plus-whole duplicate (unlike the multi-to-do fan-out, whose parent stays whole beside its children). Children are enriched on their own and never decided or split again; the parent gets `metadata.splitInto` (the fan-out guard).
  - `reference` (recipe, template, transcript, pasted document, email written to someone else): a short LLM-written pointer becomes `normalized_text`; the full body is a linked **text note**. The note body never feeds the graph — enrichment sees only the pointer (`enrichRawText`), never the whole capture.
  - `mixed`: the personal spans become thoughts (as `personal`), the reference part becomes a note **linked to every span thought** (`linkTextFileToThought`).
  - **Resumable:** the plan (`metadata.captureContentSplit` = role, spans, span thought ids, pending note, attached file) is persisted on the capture’s own thought **before** anything else is created, so a retried enrich resumes it and creates only what is missing instead of re-deciding. Rows carrying the pre-role marker (`mode: thought_only | split`) are treated as already split; old `decision_shadow_log` rows keep their old choices (read verbatim by the shadow read model, no migration).
- **Service:** [`src/lib/server/text-files/service.ts`](../../src/lib/server/text-files/service.ts) — CRUD plus `appendTextFile` (deterministic body concat for list/checklist edits).
- **Note passages (long-text memory L7-L9):** `note_passage` (migration `0083`; RLS `note_passage_isolation`) holds 3-5 sentence windows of a note body (~300-600 chars, one sentence of overlap; a body of <= 600 chars is one passage). Each passage has a 1536-d `embedding` (HNSW cosine), a folded `lexical_text` + generated `lexical_tsv` (GIN), UTF-16 `start_char`/`end_char` into the body, and `text_encrypted` (tenant-encrypted like `text_file.body_text`; there is no plaintext passage column). The chunker is pure mechanical indexing ([`chunk-note-passages.ts`](../../src/lib/server/text-files/chunk-note-passages.ts), `Intl.Segmenter`, every script) — no meaning is decided in code.
- **Passage sync lives in the text-file service, so every caller gets it** (capture split, Notes UI, chat tools): `createTextFile` / `updateTextFile` / `appendTextFile` call [`note-passages.ts`](../../src/lib/server/text-files/note-passages.ts) `preparePassageSync` (chunk -> diff against stored passages -> embed only new/changed passages, batches of 32 through the normal gateway, so cost is logged and billed like thought embeddings) **before** the write, then write the note and its passages in **one transaction**. An embedding failure fails the whole create/update/append (no note without an index, no retry-less swallow; the gateway's own 3-attempt ladder applies). Append re-embeds only the changed tail; a title-only edit embeds nothing. Notes created before `0083` are indexed by `npm run backfill:note-passages` (idempotent; operator-run; embeddings are billed to each note's owner).
- **Chat agent tools** (in-app only; `exposeInMcp: false` — **not** on HTTP MCP): `create_text_file`, `list_text_files`, `get_text_file`, `update_text_file`, `append_text_file`, `delete_text_file`, `search_text_files`, `link_text_file_to_thought`, `unlink_text_file_from_thought`. HTTP MCP remains the four thought tools only.
- **Agent contract:** Create a **new** note with `create_text_file`. Additive edits on a referenced note/list (e.g. “add milk to my shopping list”) must `search_text_files` / `list_text_files` → `append_text_file` (or get + full `update_text_file`). Never `create_text_file` for additive requests; never `capture_thought` for Notes documents. See [`agent-loop.ts`](../../src/lib/server/llm/agent-loop.ts).
- **Retrieval:** Hybrid passage search via `searchTextFiles` / `search_text_files` and `retrieve_thoughts` (`textFiles` hits), and in `composeAnswer` context — see [retrieval.md](./retrieval.md) § Note passages. Embeddings stay DB-only: no passage or query vector is ever selected into tool results, prompts or logs. Full body via `get_text_file`.

## Related but not canonical for “ingest contract”

- Schema definitions: [`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts) (and brain tables).
- Ontology: [`src/lib/server/ontology.ts`](../../src/lib/server/ontology.ts), [`src/lib/server/ontology-db.ts`](../../src/lib/server/ontology-db.ts).
