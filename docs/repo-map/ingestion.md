# Domain: Ingestion

**Canonical rule:** All server-side capture, edit, relink, and list persistence flows go through [`src/lib/server/capture/service.ts`](../../src/lib/server/capture/service.ts). HTTP and MCP are thin adapters.

## CompetingSystems

- **Postgres AGE vs FalkorDB for runtime graph:** Postgres image enables AGE and creates `eigen_graph` ([`docker/postgres/init/01-extensions.sql`](../../docker/postgres/init/01-extensions.sql)). Application graph reads/writes for thoughts, relations, and visualization use **FalkorDB** via [`src/lib/server/graph/falkor.ts`](../../src/lib/server/graph/falkor.ts). See conflict **C001** in [conflicts.md](./conflicts.md).

## Key files (scan-first)

### [`src/lib/server/capture/service.ts`](../../src/lib/server/capture/service.ts)

- **Purpose:** Single orchestration layer for thought capture, edit, relink, and listing after persistence.
- **Owns:** Transactional insert/update of `thought` rows; embedding and lexical text; Falkor upsert for thought node; relation + entity graph sync hooks; capture activity logging; ontology refresh triggers.
- **DependsOn:** Drizzle `getDb()`, LLM embedding gateway, ontology resolution, Falkor client, lexical helper, relation extraction / entity sync modules.
- **PublicSymbols:** `normalizeThoughtText`, `captureThought`, `editStoredThought`, `relinkThoughtGraph`, `deleteThoughtForUser`, `listThoughts`.
- **FailureMode:** Throws or returns `{ ok: false }` for edit when thought missing; no silent fallback for missing LLM or DB.

#### `captureThought(userId, rawInput, options?)`

- **InputContract:** Non-empty trimmed raw string; authenticated `userId`.
- **OutputContract:** Stored thought row subset (id, texts, category, metadata).
- **SideEffects:** Inserts `capture_session` and `thought`; writes embedding vector; updates Falkor; syncs relations and entities; may refresh ontology; logs activity.
- **Invariants:** Lexical text derived deterministically from normalized body; tenant is always `userId`.
- **ConflictsWith:** None for capture path; MCP and HTTP both call this (intentional dual entry, same canonical implementation).

#### `editStoredThought(userId, thoughtId, editRequest, options?)`

- **InputContract:** Existing thought owned by `userId`; non-empty edit request string.
- **OutputContract:** `{ ok: true, thought }` or `{ ok: false, reason: 'not_found' }`.
- **SideEffects:** Updates thought row, re-embeds, updates Falkor node, re-syncs relations/entities, logs activity.
- **Invariants:** Same as capture for graph/lexical/embedding consistency.

#### `relinkThoughtGraph(userId, thoughtId, options?)`

- **Purpose:** Re-run relation + entity graph sync without changing stored text; clears outgoing Falkor edges for that thought first (see file docblock).
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
- **Note:** `runListThoughtsTool` is implemented and tested but **not** registered on the HTTP MCP route — see **C002** in [conflicts.md](./conflicts.md).

### [`src/lib/capture/ingest-phases.ts`](../../src/lib/capture/ingest-phases.ts) and [`src/lib/capture/consume-capture-ndjson.ts`](../../src/lib/capture/consume-capture-ndjson.ts)

- **Purpose:** Shared phase typing and browser-side NDJSON consumer for capture UI progress.

### [`src/routes/capture/+page.svelte`](../../src/routes/capture/+page.svelte)

- **Purpose:** Primary capture UI; `fetch` to `/api/capture/submit` and edit endpoints (see UI domain for route-level summary).

## Related but not canonical for “ingest contract”

- Schema definitions: [`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts) (and brain tables).
- Ontology: [`src/lib/server/ontology.ts`](../../src/lib/server/ontology.ts), [`src/lib/server/ontology-db.ts`](../../src/lib/server/ontology-db.ts).
