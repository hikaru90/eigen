# Domain: Ingestion

**Canonical rule:** All server-side capture, edit, relink, and list persistence flows go through [`src/lib/server/capture/service.ts`](../../src/lib/server/capture/service.ts). HTTP and MCP are thin adapters.

**Embeddings boundary:** Capture/edit may **write** embeddings to Postgres; `listThoughts` and tool returns must **not** select or expose vector columns. See [embeddings-db-only-boundary.md](../planning/embeddings-db-only-boundary.md).

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
- **OutputContract:** Stored thought row subset (id, texts, category, metadata).
- **SideEffects:** Inserts `capture_session` and `thought`; writes embedding vector; updates AGE graph; syncs relations and entities; may refresh ontology; logs activity.
- **Invariants:** Lexical text derived deterministically from normalized body; tenant is always `userId`.
- **ConflictsWith:** None for capture path; MCP and HTTP both call this (intentional dual entry, same canonical implementation).

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

### [`src/routes/api/capture/submit/+server.ts`](../../src/routes/api/capture/submit/+server.ts)

- **Purpose:** Authenticated POST JSON `{ raw }`; optional NDJSON progress stream when `Accept` includes `application/x-ndjson`.
- **Owns:** Request validation, `runWithTrace` wrapper, error JSON shape.
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

## Related but not canonical for “ingest contract”

- Schema definitions: [`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts) (and brain tables).
- Ontology: [`src/lib/server/ontology.ts`](../../src/lib/server/ontology.ts), [`src/lib/server/ontology-db.ts`](../../src/lib/server/ontology-db.ts).
