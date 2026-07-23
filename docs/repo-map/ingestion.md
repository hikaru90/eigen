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

- **Purpose:** Async enrichment steps for persisted thoughts (relations, entities, memory type, cues, temporal, link materialization). Tier 2 worker calls `enrichQueuedThought`; edit/relink paths call `enrichThought` / `reenrichThought` directly.
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
- **Note:** MCP HTTP registration lives in [`registry.ts`](../../src/lib/server/mcp/registry.ts) (`capture_thought`, `list_thoughts`, `retrieve_thoughts`, `edit_thought`, `delete_thought`, `answer_question`). **C002** resolved — see [conflicts.md](./conflicts.md).

### Client capture queue (browser)

- **Canonical doc:** [capture-queue.md](./capture-queue.md) — enqueue on `/capture`, serial drain, per-item remove, NDJSON progress, offline Background Sync.
- **Code:** [`src/lib/capture/queue/`](../../src/lib/capture/queue/), [`src/routes/capture/+page.svelte`](../../src/routes/capture/+page.svelte), [`src/lib/components/capture-queue-list.svelte`](../../src/lib/components/capture-queue-list.svelte), [`src/lib/components/ingest-phase-indicator.svelte`](../../src/lib/components/ingest-phase-indicator.svelte).

### [`src/lib/capture/ingest-phases.ts`](../../src/lib/capture/ingest-phases.ts) and [`src/lib/capture/consume-capture-ndjson.ts`](../../src/lib/capture/consume-capture-ndjson.ts)

- **Purpose:** Shared phase typing and NDJSON stream consumer (used by the queue submitter and by **edit** on the capture page).

### [`src/routes/capture/+page.svelte`](../../src/routes/capture/+page.svelte)

- **Purpose:** Primary capture UI; **new submits** via `enqueueCapture` (queue). **Edits** to an already stored thought still `fetch` `/api/capture/edit` with NDJSON progress. See [capture-queue.md](./capture-queue.md).

### Notes (text files)

- **Purpose:** First-class Keep-style documents stored in `text_file` — shopping lists, notebooks, checklists, pasted reference. **Not** thoughts: no enrich queue, embedding, or graph pipeline. UI: [`/memory/notes`](../../src/routes/memory/notes/+page.svelte).
- **Optional thought links:** Capture may auto-split reference material into a linked note during enrich; Capture UI “Attach note” and chat tools `link_text_file_to_thought` / `unlink_text_file_from_thought` for manual linking. Join table: `thought_text_file` (deleting a thought removes links only; notes remain in the library).
- **Automatic split on enrich:** During background enrich, an LLM judge (`split-capture-content.ts`) partitions capture input when appropriate. **Verbatim invariant:** `thought.raw_text` is the user’s submitted text and is **never** overwritten by content-split (only an explicit edit may change it). `thought_only` (tasks, bug reports, ordinary notes) keeps `normalized_text` as whitespace-normalized original — no LLM paraphrase. `split` may distill a short pointer onto `normalized_text` and store reference material (recipes, templates, procedures, transcripts, pasted bodies) as a linked **text note**; the full original remains on `raw_text`. Split is based on **content role**, not message length.
- **Service:** [`src/lib/server/text-files/service.ts`](../../src/lib/server/text-files/service.ts) — CRUD plus `appendTextFile` (deterministic body concat for list/checklist edits).
- **Chat agent tools** (in-app only; `exposeInMcp: false` — **not** on HTTP MCP): `create_text_file`, `list_text_files`, `get_text_file`, `update_text_file`, `append_text_file`, `delete_text_file`, `search_text_files`, `link_text_file_to_thought`, `unlink_text_file_from_thought`. HTTP MCP remains the four thought tools only.
- **Agent contract:** Create a **new** note with `create_text_file`. Additive edits on a referenced note/list (e.g. “add milk to my shopping list”) must `search_text_files` / `list_text_files` → `append_text_file` (or get + full `update_text_file`). Never `create_text_file` for additive requests; never `capture_thought` for Notes documents. See [`agent-loop.ts`](../../src/lib/server/llm/agent-loop.ts).
- **Retrieval:** Lexical keyword search via `searchTextFiles` / `search_text_files` and `retrieve_thoughts` (`textFiles` hits). Included in `composeAnswer` context (no embeddings on `text_file`). Full body via `get_text_file`.

## Related but not canonical for “ingest contract”

- Schema definitions: [`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts) (and brain tables).
- Ontology: [`src/lib/server/ontology.ts`](../../src/lib/server/ontology.ts), [`src/lib/server/ontology-db.ts`](../../src/lib/server/ontology-db.ts).
