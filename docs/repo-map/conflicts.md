# Conflict ledger (L3)

Cross-domain overlaps and **unresolved** ambiguities. Domain maps reference these IDs under `CompetingSystems`.

When status is **open**, the assistant should **hard-stop** on implementation guidance that assumes a single graph stack or full MCP surface until you pick a resolution path (see [answer-protocol.md](./answer-protocol.md)).

### C001 — Graph runtime (**resolved**)

- **Resolution:** Runtime graph operations use **Apache AGE** via [`src/lib/server/graph/age.ts`](../../src/lib/server/graph/age.ts) (Cypher through `ag_catalog.cypher` on graph `AGE_GRAPH_NAME`, default `eigen_graph`).

### C002 — MCP `list_thoughts` not exposed over HTTP MCP (**resolved**)

- **Resolution:** [`src/lib/server/mcp/registry.ts`](../../src/lib/server/mcp/registry.ts) registers `list_thoughts`, `delete_thought`, and the rest of the tool suite for both HTTP MCP and `/chat` agent loop.

### Resolution playbook (short)

- **C001:** Resolved — AGE is authoritative.
- **C002:** Resolved — MCP HTTP registration includes `list_thoughts`.

When you resolve a row, set status to **resolved** in the heading and add a **Resolution** line under that ID (and update the relevant domain map `CompetingSystems` section).
