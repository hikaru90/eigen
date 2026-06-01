# Embeddings: DB-only boundary

**Status:** Enforced in code. **Risk:** Critical (ingestion, retrieval, MCP, chat).

## Policy

Embedding vectors (1536-dimensional floats for thoughts, entities, temporal events, etc.) are **core infrastructure**:

- **Allowed:** compute via the embedding gateway, store in Postgres/pgvector, use inside retrieval and consolidation (distance queries, internal pipelines).
- **Forbidden:** return vectors from MCP tools, HTTP tool-shaped APIs, chat/agent payloads, or any `llmChatCompletion` request; log full vectors or long embedding inputs.

Text fields (`normalizedText`, snippets, scores) are fine in tools and LLM prompts. **Vectors are not.**

## Why

- Vectors are large (~6k+ tokens each if serialized), leak no useful semantics to chat models, and blow context windows.
- User trust: memory content in prompts should be human-readable text, not raw numeric embeddings.

## Enforcement layers (defense in depth)

| Layer | Location | Role |
|-------|----------|------|
| Query shape | [`listThoughts`](../../src/lib/server/capture/service.ts) and similar | Explicit `.select({ ... })` **without** `embedding` columns for tool-facing reads |
| MCP tools | [`src/lib/server/mcp/tools.ts`](../../src/lib/server/mcp/tools.ts) | `sanitizeMcpToolResult()` on every tool return |
| MCP HTTP | [`src/lib/server/mcp/server.ts`](../../src/lib/server/mcp/server.ts) | Sanitize before `JSON.stringify` in `CallTool` responses |
| Agent loop | [`src/lib/server/llm/agent-loop.ts`](../../src/lib/server/llm/agent-loop.ts) | Sanitize after each tool; compact results for follow-up turns ([`agent-tool-result-compact.ts`](../../src/lib/server/llm/agent-tool-result-compact.ts)) |
| Chat gateway | [`src/lib/server/llm/llm-client.ts`](../../src/lib/server/llm/llm-client.ts) | `sanitizeChatMessages()` immediately before `POST /chat/completions` |
| Shared stripper | [`src/lib/server/observability/strip-embeddings.ts`](../../src/lib/server/observability/strip-embeddings.ts) | Removes vector field names and 1536-element numeric arrays recursively |
| Logs | [`redact-for-log.ts`](../../src/lib/server/observability/redact-for-log.ts), embedding log truncation in `llm-client` | No vector previews in `console` output |

Cursor rule: [`.cursor/rules/no-embeddings-in-llm.mdc`](../../.cursor/rules/no-embeddings-in-llm.mdc). Summary also in [`AGENTS.md`](../../AGENTS.md) (Memory indexing and tool hygiene).

## Retrieval and compose-answer

- `searchThoughts` returns **scores and text**, not stored thought embeddings.
- `composeAnswer` builds LLM prompts from `RetrievalContextItem` (id, text, category, scores, dates) — never from embedding columns.
- Query embeddings are created in-process and used only for SQL distance; they must not be attached to tool results.

## Exceptions (intentional)

- **Graph embedding map UI:** [`GET /api/embeddings/snapshot`](../../src/routes/api/embeddings/snapshot/+server.ts) returns vectors for authorized visualization only — not MCP, not chat LLM.
- **Internal enrichment:** `thoughtEmbedding` passed in-memory between capture/enrich steps on the server; never serialized to tool/LLM boundaries.

## Review checklist (PRs touching tools, chat, or list/get thought APIs)

1. New `select()` or `returning()` — are embedding columns excluded from outward-facing shapes?
2. New tool or agent path — does output pass through `sanitizeMcpToolResult`?
3. New `llmChatCompletion` caller — could message bodies include JSON with vectors? If yes, sanitize or compact first.
4. Tests — assert `"embedding"` absent from tool JSON and from messages passed to the LLM mock.

## Related requirements

- [01-requirements-baseline.md](./01-requirements-baseline.md) — MCP validation and observability
- [03-guardrails-quality-gates.md](./03-guardrails-quality-gates.md) — core policies
- [ingestion.md](../repo-map/ingestion.md), [retrieval.md](../repo-map/retrieval.md) — domain entry points
