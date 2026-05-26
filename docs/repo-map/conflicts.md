# Conflict ledger (L3)

Cross-domain overlaps and **unresolved** ambiguities. Domain maps reference these IDs under `CompetingSystems`.

When status is **open**, the assistant should **hard-stop** on implementation guidance that assumes a single graph stack or full MCP surface until you pick a resolution path (see [answer-protocol.md](./answer-protocol.md)).

### C001 — Postgres AGE vs FalkorDB at runtime (**resolved**)

- **Resolution:** Runtime graph operations use **Apache AGE** via [`src/lib/server/graph/falkor.ts`](../../src/lib/server/graph/falkor.ts) (Cypher through `ag_catalog.cypher` on graph `AGE_GRAPH_NAME`, default `eigen_graph`). FalkorDB removed from `docker-compose.yaml`. One-time migration: [`scripts/migrate-graph-falkor-to-age.mjs`](../../scripts/migrate-graph-falkor-to-age.mjs). Legacy Falkor client kept in [`falkor-legacy.ts`](../../src/lib/server/graph/falkor-legacy.ts) for rollback reference. Rollback: [`docs/planning/08-age-cutover-rollback.md`](../planning/08-age-cutover-rollback.md).

### C002 — MCP `list_thoughts` not exposed over HTTP MCP (**resolved**)

- **Resolution:** [`src/lib/server/mcp/registry.ts`](../../src/lib/server/mcp/registry.ts) registers `list_thoughts`, `delete_thought`, and the rest of the tool suite for both HTTP MCP and `/chat` agent loop.

### Resolution playbook (short)

- **C001:** Resolved — AGE is authoritative; use rollback doc if reverting.
- **C002:** Either add `list_thoughts` to MCP HTTP registration or remove `runListThoughtsTool` if unused, and align docs.

When you resolve a row, set status to **resolved** in the heading and add a **Resolution** line under that ID (and update the relevant domain map `CompetingSystems` section).
