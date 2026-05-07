# FalkorDB Migration Findings

## Scope
This note evaluates replacing Eigen's current PostgreSQL/Drizzle data layer with FalkorDB and records key Cypher-language findings relevant to implementation.

## Sources
- FalkorDB TypeScript client (`falkordb-ts`): https://github.com/falkordb/falkordb-ts
- FalkorDB Cypher docs: https://docs.falkordb.com/cypher/

## Current Eigen State (impact baseline)
- App and auth are tightly coupled to Drizzle + PostgreSQL (`authDb`, `getDb`, RLS session context).
- Core domain tables are relational with FK constraints:
  - auth/session/account/user
  - `capture_session`, `thought`, `thought_relation`, `activity_call_log`, `user_preference`
- Current memory retrieval design already depends on:
  - vector column (`thought.embedding vector(1536)`)
  - lexical surface (`thought.lexical_text`)
  - graph relation table (`thought_relation`)
- Better Auth currently uses Drizzle adapter and SQL-backed schema (`src/lib/server/auth.ts`, `src/lib/server/db/auth.schema.ts`).

## FalkorDB / Cypher Findings

### Client and connectivity
- `falkordb-ts` is a Node client, connects over Redis-style socket settings (host/port), and queries via `graph.query(...)`.
- Typical setup is Dockerized FalkorDB on port `6379`.
- Parameterized query usage is supported from the client call pattern in the README example.

### Cypher support and behavior
- FalkorDB supports OpenCypher (subset of version 9) plus proprietary extensions.
- Core clause set includes `MATCH`, `CREATE`, `MERGE`, `WHERE`, `RETURN`, `WITH`, `CALL`, etc.
- Query comments are supported (`//` and `/* ... */`), useful for diagnostics and query templates.
- Parameterized queries are supported (docs show `CYPHER` parameter prefix; client libraries provide safe param APIs).

### Indexing and retrieval capabilities
- FalkorDB docs explicitly expose:
  - range index
  - full-text index
  - vector index
- Native graph algorithms are available (e.g., PageRank/BFS/shortest paths family), which can reduce custom SQL/AGE plumbing for some retrieval paths.

## Can Eigen switch to FalkorDB?
Yes, but a full replacement is a major architecture migration, not a drop-in driver swap.

## Recommended migration strategy (practical)

### Phase 1 (recommended): Hybrid
- Keep PostgreSQL + Drizzle for:
  - Better Auth tables and sessions
  - activity/cost logs and transactional app metadata
  - existing RLS tenancy guarantees
- Introduce FalkorDB for memory graph + graph retrieval only:
  - thoughts as nodes
  - relations as edges
  - optional embedding/vector index and lexical index in FalkorDB
- Mirror writes from capture/edit flows to FalkorDB while preserving SQL source of truth initially.

### Phase 2: Retrieval cutover
- Move graph traversal and graph-expansion ranking reads to FalkorDB Cypher.
- Keep compatibility tests to compare SQL+AGE vs FalkorDB results for a period.

### Phase 3 (optional): Deeper consolidation
- Only consider moving auth/tenant/accounting away from PostgreSQL if product constraints justify losing current Drizzle+RLS simplicity.

## Why not full immediate replacement?
- Better Auth in this codebase is Drizzle-first today; replacing auth persistence introduces high risk.
- Current transactional flows (capture + cost log + update semantics) rely on SQL transactions and familiar relational constraints.
- Existing Docker/self-host flow is already stable for Postgres + AGE + pgvector.

## Concrete next implementation step if we proceed
1. Add a FalkorDB client adapter (`src/lib/server/graph/falkor.ts`) and env config (`FALKOR_HOST`, `FALKOR_PORT`, `FALKOR_GRAPH`).
2. Implement a write-through prototype in capture/edit service:
   - create/update thought node
   - create relation edges
3. Add one retrieval endpoint path using Cypher `MATCH` + parameterized filters.
4. Add integration tests validating tenancy scoping and deterministic ranking behavior against the new path.

## Decision summary
- **Feasible:** yes.
- **Best path:** hybrid migration first, not immediate full DB replacement.
- **Primary risk area:** auth/session and transactional integrity if Postgres is removed too early.
