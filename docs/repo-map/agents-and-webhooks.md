# Connected agents and webhooks

Eigenmesh orchestration: connect external agents to your brain via signed webhooks.

## Layers

| Layer         | Role                                                              |
| ------------- | ----------------------------------------------------------------- |
| **Brain**     | Thoughts, enrichment, GTD, MCP memory tools                       |
| **Eigenmesh** | Agent registry, event push, task assignment, completion callbacks |
| **Agents**    | Workers that receive webhooks and optionally use MCP              |

## Register an agent

Settings → **Connected agents** (`/settings/agents`):

1. Name + HTTPS webhook URL
2. Select thought events (`thought.created`, `thought.enriched`, `thought.updated`, `thought.deleted`)
3. Save **signing secret** and **callback token** (shown once)

## Outbound webhooks

Eigen POSTs JSON to your webhook URL. Generic mode (default) headers:

- `X-Event-Type` — event type (e.g. `thought.enriched`, `webhook.test`)
- `X-Request-ID` — delivery UUID
- `X-Webhook-Signature` — HMAC-SHA256 hex of the raw body (no `sha256=` prefix)

GitHub / GitLab signature modes use the corresponding platform headers (`X-GitHub-Event`, `X-Gitlab-Event`, etc.).

Payload envelope:

```json
{
  "event": "thought.enriched",
  "event_type": "thought.enriched",
  "eventId": "<thought-uuid>",
  "timestamp": "2026-06-23T12:00:00.000Z",
  "data": { "thoughtId": "...", "category": "task", "memoryType": "open_loop" }
}
```

`event` is canonical; `event_type` is the same string for receivers (e.g. Hermes) that only inspect the body field `event_type`. Embeddings are never included.

## Task assignment

Assign an open-loop/task thought from Timeline detail → **Assign to agent**.

Agent receives `agent.task.assigned` with `assignmentId`, `thoughtId`, and text context.

## Inbound completion

```http
POST /api/agents/callback/complete
Authorization: Bearer eigen_cb_…
Content-Type: application/json

{
  "assignmentId": "<uuid>",
  "status": "completed",
  "resultSummary": "Done — drafted reply",
  "captureText": "Optional result thought to capture"
}
```

## MCP complement

- **Webhooks** — push notifications and assigned work
- **MCP** (`/api/mcp` + `eigen_*` API key) — pull memory tools during agent work

## Code

- [`src/lib/server/agents/`](../src/lib/server/agents/) — emit, deliver, assign, complete
- [`src/routes/api/agents/`](../src/routes/api/agents/) — REST API
- Job queue type `webhook_delivery` in [`drain.ts`](../src/lib/server/job-queue/drain.ts)
