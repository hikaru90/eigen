# Assistant answer protocol

Use this when answering architecture or implementation questions about this repository. It complements [`AGENTS.md`](../../AGENTS.md) project guardrails.

## Before suggesting code changes

1. Read [`docs/repo-map/index.md`](./index.md) and the **relevant domain** L2 file (`ingestion.md`, `capture-queue.md`, `retrieval.md`, `auth-and-tenancy.md`, `ui-surfaces.md`).
2. Read [`conflicts.md`](./conflicts.md). If the question touches a topic with status **open** (e.g. C001, C002), **stop** and surface the conflict first.
3. Prefer citing **canonical files** from the domain map. If code and map disagree, treat **code as ground truth** and note that the map is **stale** (suggest updating the map in the same session).

## Hard-stop rules

- **Unresolved conflict:** Do not recommend a single implementation path that assumes the conflict is already decided. Give options (pick canonical system, merge, delete duplicate, or document intentional dual use) and cite `conflicts.md`.
- **Unknown:** If you lack evidence (file not read, behavior not traced), say **unknown** instead of inferring.

## After code changes (human or agent)

Follow [`maintenance.md`](./maintenance.md) so L0–L3 stay aligned.
