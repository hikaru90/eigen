# Domain: UI surfaces

**Canonical rule:** Product UI lives under [`src/routes/`](../../src/routes/). Mutations from the browser use **native `fetch`** to explicit `+server.ts` routes (per project guardrails), not ad-hoc server functions from client bundles.

## CompetingSystems

- **Demo routes vs product:** [`src/routes/demo/`](../../src/routes/demo/) contains Paraglide and Playwright demos — not the memory product surface. Prefer [`capture`](../../src/routes/capture/), [`memory`](../../src/routes/memory/), [`chat`](../../src/routes/chat/), [`activity`](../../src/routes/activity/), [`settings`](../../src/routes/settings/) for product behavior.

## Route map (high level)

Each entry: **Purpose** / **Owns** (user-visible concern) / **Key server load** (if any).

- **[`/`](../../src/routes/+page.svelte)** — Landing / home. Load: [`+page.server.ts`](../../src/routes/+page.server.ts).
- **`/capture`** — Primary thought capture and post-capture edit UI. **New submits** use the client capture queue ([capture-queue.md](./capture-queue.md)); **edits** `fetch` `/api/capture/edit`. Load: [`capture/+page.server.ts`](../../src/routes/capture/+page.server.ts).
- **`/memory`** — Memory hub (bottom nav). Secondary floating nav: **Graph** (default), **Embeddings** (`?view=embeddings`), **Timeline** (`/memory/timeline`), **Notes** (`/memory/notes`). Graph tab load: [`memory/+page.server.ts`](../../src/routes/memory/+page.server.ts) (AGE snapshot, ontology legend, community overlays). Timeline load: [`memory/timeline/+page.server.ts`](../../src/routes/memory/timeline/+page.server.ts). Notes load: [`memory/notes/+page.server.ts`](../../src/routes/memory/notes/+page.server.ts). Shared layout: [`memory/+layout.svelte`](../../src/routes/memory/+layout.svelte) + [`memory-surface-nav.svelte`](../../src/lib/components/memory-surface-nav.svelte). Graph viz components remain under [`src/routes/graph/`](../../src/routes/graph/); timeline UI components under [`src/routes/timeline/`](../../src/routes/timeline/).
- **Legacy redirects:** `/graph`, `/timeline`, `/notes` (and `/graph?tab=temporal`) redirect to the matching `/memory/*` path with query params preserved.
- **`/chat`** — Memory assistant UI (default: `answer_question`; completion reports search via `retrieve_thoughts` then `edit_thought`/`delete_thought`; full MCP tool surface) backed by [`/api/chat`](../../src/routes/api/chat/+server.ts) and session routes.
- **`/activity`** — Usage / activity views. Load: [`activity/+page.server.ts`](../../src/routes/activity/+page.server.ts).
- **`/settings`** — User settings (language, theme, LLM provider, **push notifications**). Load: [`settings/+page.server.ts`](../../src/routes/settings/+page.server.ts).
- **`/api-keys`** — API key management UI. Load: [`api-keys/+page.server.ts`](../../src/routes/api-keys/+page.server.ts).
- **`/login`**, **`/register`** — Auth flows.
- **`/eval`** — System evaluation harness (dev only): QA catalog and runs.

## API routes (browser or MCP)

- Documented in **ingestion** and **retrieval** domain maps; UI typically hits `/api/capture/*`, `/api/retrieval/search`, `/api/chat/*`, `/api/entities/*`, `/api/thoughts/*` as implemented. When adding a new button, trace to the matching `+server.ts` and update the relevant domain map.
- **PWA / push:** manifest at `static/manifest.webmanifest`; service worker [`src/service-worker.ts`](../../src/service-worker.ts) (push / `notificationclick` + **capture queue Background Sync** — no Workbox precache). Client registration in [`src/routes/+layout.svelte`](../../src/routes/+layout.svelte). Push APIs: `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`, `/api/push/vapid-public-key` (requires `VAPID_*` env vars).
- **Capture queue (canonical):** [capture-queue.md](./capture-queue.md) — IndexedDB queue, layout runner, service worker Background Sync, queue list UI, ingest step indicator.

## Components

- Reusable UI: [`src/lib/components/`](../../src/lib/components/) (shadcn-svelte under `ui/` per AGENTS.md).
