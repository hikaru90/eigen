# Domain: UI surfaces

**Canonical rule:** Product UI lives under [`src/routes/`](../../src/routes/). Mutations from the browser use **native `fetch`** to explicit `+server.ts` routes (per project guardrails), not ad-hoc server functions from client bundles.

## CompetingSystems

- **Demo routes vs product:** [`src/routes/demo/`](../../src/routes/demo/) contains Paraglide and Playwright demos — not the memory product surface. Prefer [`capture`](../../src/routes/capture/), [`memory`](../../src/routes/memory/), [`chat`](../../src/routes/chat/), [`activity`](../../src/routes/activity/), [`settings`](../../src/routes/settings/) for product behavior.

## Route map (high level)

Each entry: **Purpose** / **Owns** (user-visible concern) / **Key server load** (if any).

- **[`/`](../../src/routes/+page.svelte)** — Landing / home. Load: [`+page.server.ts`](../../src/routes/+page.server.ts).
- **`/capture`** — Primary thought capture and post-capture edit UI. **New submits** use the client capture queue ([capture-queue.md](./capture-queue.md)); **edits** `fetch` `/api/capture/edit`. Load: [`capture/+page.server.ts`](../../src/routes/capture/+page.server.ts).
- **`/desk`** — WebGL desk hub (Three.js, imperative factory [`desk/desk-scene.ts`](../../src/routes/desk/desk-scene.ts) + thin Svelte wrapper, mirroring the embedding-map pattern). Active GTD projects render as **piles of paper** (InstancedMesh, sheet count = open task count), open unassigned tasks as **loose sheets**, and the graph snapshot nodes as **pinned notes on a wall** behind the desk. Default view for projects and tasks: `/timeline` legacy redirect now lands here; pile click → `/memory/projects/[entityId]`, task click → `/memory/tasks?event=…`, note click → `/memory`. Drag task sheet onto a pile → `POST /api/timeline/projects/assign`; right-click task → mark done via `POST /api/temporal-events/[id]/action`. Palette resolves live CSS variables incl. oklch ([`desk/desk-theme.ts`](../../src/routes/desk/desk-theme.ts)) and re-applies on `theme-preference-change`; wall notes carry id/label/kind only — never embeddings. Layout/picking math ([`desk/desk-layout.ts`](../../src/routes/desk/desk-layout.ts)), label projection/culling ([`desk/desk-labels.ts`](../../src/routes/desk/desk-labels.ts)) are pure and unit-tested; E2E: [`e2e/desk.e2e.ts`](../../src/routes/e2e/desk.e2e.ts). Load: [`desk/+page.server.ts`](../../src/routes/desk/+page.server.ts) (shared timeline prefetch + AGE node snapshot, `edgeLimit: 1`).
- **`/memory`** — Memory hub (bottom nav). Secondary floating nav: **Desk** (default, first tab), **Graph**, **Embeddings** (`?view=embeddings`), **Tasks** (`/memory/tasks`), **Projects** (`/memory/projects`), **Notes** (`/memory/notes`). Graph tab load: [`memory/+page.server.ts`](../../src/routes/memory/+page.server.ts) (AGE snapshot, ontology legend, community overlays). Tasks/Projects load: [`memory/tasks/+page.server.ts`](../../src/routes/memory/tasks/+page.server.ts) / [`memory/projects/+page.server.ts`](../../src/routes/memory/projects/+page.server.ts) (shared prefetch via [`timeline-page-load.ts`](../../src/routes/timeline/timeline-page-load.ts)). **Project detail** (`/memory/projects/[entityId]`): dedicated page with List / Timeline (Gantt) / Kanban (lifecycle) views and **Tidy up project** review (`POST /api/timeline/projects/[entityId]/review` dry-run + `/review/apply` after confirm); load via [`project-detail.ts`](../../src/lib/server/memory/project-detail.ts). Notes load: [`memory/notes/+page.server.ts`](../../src/routes/memory/notes/+page.server.ts). Shared layout: [`memory/+layout.svelte`](../../src/routes/memory/+layout.svelte) + [`memory-surface-nav.svelte`](../../src/lib/components/memory-surface-nav.svelte). Graph viz components remain under [`src/routes/graph/`](../../src/routes/graph/); tasks/projects UI components under [`src/routes/timeline/`](../../src/routes/timeline/).
- **Legacy redirects:** `/graph`, `/timeline`, `/notes`, `/memory/timeline` (and `/graph?tab=temporal`) redirect to the matching `/memory/*` path with query params preserved (`/timeline` and `/memory/timeline` → `/desk`, preserving `?event=`).
- **`/chat`** — Memory assistant UI (agent tool loop over thought CRUD plus chat-only Notes tools including `append_text_file`; see [ingestion.md](./ingestion.md) Notes section) backed by [`/api/chat`](../../src/routes/api/chat/+server.ts) and session routes.
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
