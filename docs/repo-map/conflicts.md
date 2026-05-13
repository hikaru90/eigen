# Conflict ledger (L3)

Cross-domain overlaps and **unresolved** ambiguities. Domain maps reference these IDs under `CompetingSystems`.

When status is **open**, the assistant should **hard-stop** on implementation guidance that assumes a single graph stack or full MCP surface until you pick a resolution path (see [answer-protocol.md](./answer-protocol.md)).

### C001 — Postgres AGE vs FalkorDB at runtime (**open**)

- **Affected locations:** Docker init creates AGE graph `eigen_graph` ([`docker/postgres/init/01-extensions.sql`](../../docker/postgres/init/01-extensions.sql)). App graph operations (capture sync, retrieval expansion, graph page) use Falkor ([`src/lib/server/graph/falkor.ts`](../../src/lib/server/graph/falkor.ts)). Planning/guardrail docs still describe “pgvector + AGE” as core ([`AGENTS.md`](../../AGENTS.md), [`docs/planning/`](../../docs/planning/)).
- **Risk:** Misleading mental model: someone adds AGE queries expecting them to stay in sync with Falkor; dual graph drift.

### C002 — MCP `list_thoughts` not exposed over HTTP MCP (**open**)

- **Affected locations:** `runListThoughtsTool` exists in [`src/lib/server/mcp/tools.ts`](../../src/lib/server/mcp/tools.ts) (and tests) but [`src/routes/api/mcp/+server.ts`](../../src/routes/api/mcp/+server.ts) `TOOL_MAP` / `TOOL_DEFINITIONS` only register capture, retrieve, edit, answer.
- **Risk:** External MCP clients cannot list thoughts via the same endpoint; behavior differs from a “full tool suite” expectation.

### Resolution playbook (short)

- **C001:** Either (a) document intentional “AGE provisioned, Falkor authoritative for app graph” and keep both, (b) migrate retrieval/capture to AGE and retire Falkor, or (c) remove AGE from init if truly unused — each is a product decision.
- **C002:** Either add `list_thoughts` to MCP HTTP registration or remove `runListThoughtsTool` if unused, and align docs.

When you resolve a row, set status to **resolved** in the heading and add a **Resolution** line under that ID (and update the relevant domain map `CompetingSystems` section).
