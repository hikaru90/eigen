# Repo map (L1)

Scan-first index of domains. Read [README](../../README.md) for stack and ops, then open **one** domain file (L2) for implementation detail. Cross-cutting contradictions live in [conflicts.md](./conflicts.md) (L3).

How to use this layer: pick a domain → read its L2 file → if it points to a conflict ID, read that row in `conflicts.md`.

- **Ingestion** — Persist thoughts: normalize, classify, embed, lexical index, Postgres + Apache AGE graph sync, activity logging. L2: [ingestion.md](./ingestion.md).
- **Client capture queue** — Browser IndexedDB queue, serial drain, NDJSON progress UI, offline sync. L2: [capture-queue.md](./capture-queue.md).
- **Retrieval** — Hybrid search (vector + lexical + AGE graph RRF), API + MCP + QA compose. L2: [retrieval.md](./retrieval.md).
- **Auth and tenancy** — Better Auth sessions, scoped Postgres via `app.current_user_id`, RLS policies. L2: [auth-and-tenancy.md](./auth-and-tenancy.md).
- **UI surfaces** — SvelteKit routes and client fetch patterns for capture, graph, chat, settings, etc. L2: [ui-surfaces.md](./ui-surfaces.md).
- **Consolidation (sleep)** — Nightly pg_cron → salience decay, ontology prune, graph communities, open-loop boost. L2: [consolidation.md](./consolidation.md).

Supporting docs (not domain maps):

- [answer-protocol.md](./answer-protocol.md) — how the coding assistant should answer when maps and code disagree.
- [maintenance.md](./maintenance.md) — when to update which layer after a change.
- [Embeddings DB-only boundary](../planning/embeddings-db-only-boundary.md) — vectors in Postgres only; never in MCP tools or LLM calls.
