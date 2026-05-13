# Domain: UI surfaces

**Canonical rule:** Product UI lives under [`src/routes/`](../../src/routes/). Mutations from the browser use **native `fetch`** to explicit `+server.ts` routes (per project guardrails), not ad-hoc server functions from client bundles.

## CompetingSystems

- **Demo routes vs product:** [`src/routes/demo/`](../../src/routes/demo/) contains Paraglide and Playwright demos — not the memory product surface. Prefer [`capture`](../../src/routes/capture/), [`graph`](../../src/routes/graph/), [`chat`](../../src/routes/chat/), [`activity`](../../src/routes/activity/), [`settings`](../../src/routes/settings/) for product behavior.

## Route map (high level)

Each entry: **Purpose** / **Owns** (user-visible concern) / **Key server load** (if any).

- **[`/`](../../src/routes/+page.svelte)** — Landing / home. Load: [`+page.server.ts`](../../src/routes/+page.server.ts).
- **`/capture`** — Primary thought capture and post-capture edit UI; `fetch` to `/api/capture/*`. Load: [`capture/+page.server.ts`](../../src/routes/capture/+page.server.ts).
- **`/graph`** — Graph visualization and ontology admin actions. Load: [`graph/+page.server.ts`](../../src/routes/graph/+page.server.ts) (Falkor snapshot, ontology legend).
- **`/chat`** — Chat UI backed by [`/api/chat`](../../src/routes/api/chat/+server.ts) and session routes.
- **`/activity`** — Usage / activity views. Load: [`activity/+page.server.ts`](../../src/routes/activity/+page.server.ts).
- **`/settings`** — User settings (e.g. language). Load: [`settings/+page.server.ts`](../../src/routes/settings/+page.server.ts).
- **`/api-keys`** — API key management UI. Load: [`api-keys/+page.server.ts`](../../src/routes/api-keys/+page.server.ts).
- **`/login`**, **`/register`** — Auth flows.
- **`/evals`** — Eval harness surface (development-oriented).

## API routes (browser or MCP)

- Documented in **ingestion** and **retrieval** domain maps; UI typically hits `/api/capture/*`, `/api/retrieval/search`, `/api/chat/*`, `/api/entities/*`, `/api/thoughts/*` as implemented. When adding a new button, trace to the matching `+server.ts` and update the relevant domain map.

## Components

- Reusable UI: [`src/lib/components/`](../../src/lib/components/) (shadcn-svelte under `ui/` per AGENTS.md).
