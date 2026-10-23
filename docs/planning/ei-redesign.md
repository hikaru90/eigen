# EI redesign — implementation plan

Source of truth for the redesign: the prototype repo at `~/+Code/ei` (`DESIGN.md` is the spec;
`index.html`, `styles.css`, `app.js`, `assets/*.js` are the reference implementation). Read
`DESIGN.md` **fully** before touching anything in this effort. Prototype copy text (sample
thoughts, names, numbers) is placeholder — keep the *vocabulary and tone*, not the fixture
sentences.

## Decision log (operator, 2026-10-20)

1. **Mesh IA is deliberately reduced.** Yarn, Threads, Patterns only. Desk, Graph, Embeddings,
   Notes and the old Tasks hub are **left out on purpose** — they were not forgotten. Their
   routes stay alive and reachable by URL but get no entry in the new chrome. The raw graph may
   return later in some form; out of scope now.
2. **Vocabulary is adopted** (en + de via paraglide): Mesh, Yarn, Threads, Patterns, Ask,
   Forget (not delete), Loose ends (not uncategorized), whispers ("knitting it in…"). Code
   identifiers, routes and the data model stay technical. `DESIGN.md`: "In code it's still the
   circle view."
3. **Capture moves interpretation up front.** While the user types or speaks, the interpret
   pass (`POST /api/capture/interpret`) runs (debounced) and the UI shows the live reading
   ("Sounds like a to-do, loose for now") with inline type/thread controls. Pressing Capture
   submits the *already-confirmed* interpretation — the post-submit confirmation modal goes
   away. Verbatim invariant unchanged: `raw_text` keeps the typed words; the accepted
   interpretation goes to `normalized_text`.
4. **Make me better is the multiplayer + self-healing surface.** Vision: anyone posts ideas and
   bugs, votes surface them, an always-on agent picks up voted items (operator sign-off
   remains). This pass ships the **full page UI** backed by a clearly-marked client fixture
   (`*.fixture.*`); real board backend is a later pass. Header entry, glimpse and the clay-dot
   note are real chrome.

## Surface mapping

| ei design | eigen implementation | Notes |
| --- | --- | --- |
| Capture | `/capture` (rewrite) | Writer + live reading + mic + echo; keeps queue, attachments, voice input |
| Mesh → Yarn | `/mesh/yarn` (new) | Dreamline/journal of thoughts, grouped by day. Moves off the capture page |
| Mesh → Threads | `/mesh/threads` (new) | GTD projects, restyled: where it stands, open questions, thoughts, Loose ends |
| Mesh → Patterns | `/mesh/patterns` (new surface + additive endpoint) | Meta-level patterns (LLM judge — **no string heuristics**, repo guardrail) |
| Ask | `/chat` (restyle) | Writer at rest centered, docks when conversation starts; agent loop, citations, credits kept |
| A thought, up close | `/thought/[id]` (new page, never a modal) | Echoes, thread, pattern, edit in place, Forget |
| Make me better | `/feedback` (rebuild UI, fixture board) | Entry lives in the header, outside the bottom menu |
| You menu | header sheet | Look (Light/Dark/Auto — existing theme system), links to `/settings`, `/api-keys`, `/activity`, Sign out |
| (left out) | `/desk`, `/memory/graph`, `/memory` embeddings/notes/tasks | Routes intact, no nav entry |

**Routes / redirects:** `/mesh` is the hub (`/mesh` → `/mesh/yarn`). `/memory` redirects to
`/mesh`. `/memory/tasks`, `/memory/projects`, `/memory/projects/[entityId]`, `/memory/notes`,
`/desk` keep working, unlinked. Legacy redirect chain stays intact. `/chat` keeps its path
(nav label: Ask).

## Design-system contracts (wave 1 defines, later waves consume)

Tokens land in `src/routes/layout.css`, mapped onto the existing shadcn variables so every
existing page inherits the palette (see ei `styles.css` `:root`):

- Surfaces: `--paper` (= `--background`), `--paper-2`, `--raised` (= `--card`). Ink:
  `--ink` (= `--foreground`), `--ink-2`, `--ink-3` (text-grade), `--ink-4`/`--line`
  (decorative only). Signal: `--signal`, `--signal-2`. People: `--clay`, `--clay-2`.
  Yarn: `--yarn-capture`, `--yarn-mesh`, `--yarn-ask`. Dark theme uses ei's dark palette
  under the existing `.dark` class + `theme-preference` system (do **not** switch to
  `data-theme`/localStorage-key changes — keep the existing store and event).
- Voices: `--font-you: 'Geist Mono'` (thoughts, thread names, questions — the user),
  `--font-mesh: 'Inter'` (answers, labels, chrome — the mesh). Both fonts are already
  installed via fontsource.
- One container `main` with the edge mask; header and bottom nav float, no boxes; only menus
  (you-menu, pickers) are translucent-paper surfaces. Motion: settle (blur→sharp, long
  ease-out 400–1100 ms, `--ease`), never pop. `prefers-reduced-motion` snaps.

Components (wave 1 owns; stable APIs):

- `src/lib/components/brand/eigen-mark.svelte` — the six-square mark. Props: `size?: number`.
- `src/lib/components/brand/menu-mark.svelte` — menu icons. Props:
  `kind: 'capture' | 'mesh' | 'ask'`, `active?: boolean`. Active draws yarn in the item's
  `--yarn-*` color.
- `src/lib/components/brand/mesh-spinner.svelte` — the three-square spinner. Props:
  `working: boolean`, `size?: number`.
- `src/lib/motion/settle.ts` — DOM helpers ported from ei `app.js`: `flyThought(from, toEl)`,
  `yarnTrail(...)`, released-word ghost. Called from event boundaries, never `$effect`.
- `src/lib/stores/whisper.svelte.ts` — whisper store (`show(steps)`), header renders it.
- Wordmark: reuse/replace `eigen-wordmark.svelte` with Geist Mono wordmark.

## Paraglide key inventory (wave 1 creates en + de; later waves use these)

`nav.capture, nav.mesh, nav.ask, nav.make_me_better, mesh.tabs.yarn, mesh.tabs.threads,
mesh.tabs.patterns, capture.placeholder, capture.action, capture.reading.sounds_like,
capture.reading.loose, capture.reading.new_thread, capture.mic, capture.echo_label,
ask.placeholder, ask.try, ask.clear, yarn.search, yarn.no_matches, threads.* (where_it_stands,
open_questions, thoughts, loose_ends, make_it_a_thread), patterns.empty, patterns.forming,
thought.echoes, thought.forget, thought.forget_confirm, thought.edit, better.tabs.requested,
better.tabs.in_progress, better.tabs.shipped, better.composer_placeholder, better.share,
better.votes_left, whisper.settling, whisper.knitting, whisper.kept, whisper.forgotten,
whisper.done, you.look, you.light, you.dark, you.auto, you.profile, you.settings, you.api_keys,
you.usage, you.sign_out` — de translations in the ei voice ("Garn", "Fäden", "Muster",
"Vergessen", "Lose Enden", "niederlegen…"). If a surface needs more, it reports the key in its
result; the sweep wave adds them. Only wave 1 edits `messages/*.json`.

## Guardrails every agent must keep (repo rules, non-negotiable)

- **No `$effect` for control flow.** Event boundaries, `onMount`, form actions, explicit
  calls after mutations. `$derived` for pure view state.
- **No string heuristics for meaning.** Category/thread/pattern decisions come from LLM calls
  with JSON schema contracts; code only validates, persists, renders.
- **Embeddings are DB-only** — never in tool results, messages, logs, or UI payloads.
- Native `fetch` to explicit `+server.ts` routes for mutations; no invented endpoints.
- TDD for pure logic modules: spec first (`*.spec.ts` colocated), then implementation.
  Components get at least smoke-level specs where the repo has the pattern.
- Components: `dash-case.svelte` filenames (repo lint enforces). Match existing code style.
- Existing behavior and tests keep working unless this plan says otherwise. Fix root causes,
  never weaken assertions. Mobile-first, WCAG AA on `--paper`/`--paper-2`/`--raised`,
  hover only under `@media (hover: hover)`, no keyboard hints on touch.

## Waves and file ownership (no file is touched by two agents in the same wave)

**Wave 1 — Foundation (4 parallel)**
1. *Tokens & paper*: `src/routes/layout.css` (+ `src/app.html` if fonts/meta need it).
2. *Brand & motion primitives*: `src/lib/components/brand/*`, `src/lib/motion/*`,
   `src/lib/stores/whisper.svelte.ts`, `src/lib/components/eigen-wordmark.svelte`.
3. *Chrome*: `src/routes/+layout.svelte`, `src/lib/components/app-header.svelte` (retire or
   reduce to auth-shell use), `src/lib/components/chrome/*` (header, you-menu, bottom nav,
   make-me-better entry). Keeps PWA/push/analytics/beta/capture-queue wiring intact; auth
   paths stay chrome-free.
4. *Vocabulary*: `messages/en.json`, `messages/de.json` per the inventory above.

**Wave 2 — Core surfaces (4 parallel)**
1. *Capture*: `src/routes/capture/*`, capture components in `src/lib/components/capture-*`
   as needed. Interpret-as-you-type reading, inline pickers (`#` inline thread, type menu,
   pencil), submit-confirmed ingest, dot flight + yarn trail + whisper, echo. Remove the
   recent-thoughts list from capture (Yarn owns it now); keep queue/attachments/voice.
2. *Mesh hub + Yarn*: `src/routes/mesh/+layout.svelte`, `+page.svelte` (redirect),
   `src/routes/mesh/yarn/*`, `src/lib/components/mesh/*` (thought row, tick, open control,
   tab group, search), `src/routes/memory/+page.svelte` (redirect to `/mesh`). Day-grouping
   logic as pure module + spec first.
3. *Ask*: `src/routes/chat/*`, chat components. Restyle to the Ask design; keep streaming,
   sessions, tools, credits, voice; suggestions ("Try asking"); Clear.
4. *Patterns*: `src/routes/mesh/patterns/*` + one additive `+server.ts` endpoint (LLM judge
   over existing thought/graph data, cached; no new migrations unless unavoidable — report
   if a migration is truly needed). Insight sentence + pattern cards; "Make it a thread" →
   existing project-create API.

**Wave 3 — New surfaces (4 parallel)**
1. *Thought page*: `src/routes/thought/[id]/*` (+ retrieval echoes, `/api/capture/edit`,
   project assign, forget). Full page, ✕/swipe-down to leave.
2. *Threads*: `src/routes/mesh/threads/*` reusing `project-detail` server module and
   `timeline-page-load`; must not edit `/mesh/+layout.svelte` (tabs already exist).
3. *Make me better*: `src/routes/feedback/*`, `src/lib/feedback/fixture-board.ts` (marked),
   board UI per DESIGN.md.
4. *Sweep*: redirects (`/memory` chain, verify legacy), i18n keys reported missing by wave 2/3
   (en+de), restyle-lite pass over `/settings`, `/api-keys`, `/activity` (they inherit tokens;
   fix only what looks broken), update `docs/repo-map/ui-surfaces.md`.

**Wave 4 — Gates and fixes**
`npm run lint`, `npm run check`, `npm run test:unit`, `npm run assert:svelte-naming` until
green (bounded rounds, root-cause fixes). E2E stays operator-owned (no `playwright` run in
CI); new/updated e2e specs are written but not executed here. Evals are not run.

## Acceptance criteria (core, Given/When/Then)

- **Capture up-front reading.** Given ≥8 typed chars, When interpret returns, Then the reading
  shows type + thread ("Sounds like a to-do, loose for now") with tappable type/thread and the
  field steps back; When Capture is pressed, Then ingest submits the confirmed interpretation
  with `raw_text` = typed words, no modal appears, the dot flies into Mesh and the whisper runs
  "settling… knitting it in… kept".
- **Yarn.** Given thoughts across days, When I open `/mesh/yarn`, Then thoughts render grouped
  by day with running-stitch separators, to-dos show a tick ring, every row has an explicit
  open control, rows never open on tap, search filters in place.
- **Threads.** Given GTD projects, When I open `/mesh/threads`, Then each shows where it
  stands, open questions, its thoughts and loose ends stay visible.
- **Ask.** Given no conversation, Then the writer sits centered with "Ask what you already
  know" + suggestion pills; When I ask, Then it docks to the bottom, phases show
  recalling → following the threads → writing with the spinner, and citations open thoughts.
- **Thought page.** Given a row's open control, When tapped, Then a full page fades in with
  the thought, echoes, thread and actions (edit in place, Forget with arm step); ✕ and
  swipe-down leave.
- **Chrome.** Given any product page, Then one container + floating header/bottom nav
  (Capture, Mesh, Ask) render, the you-menu holds Look wired to the live theme system, and
  Make me better sits left of the you-menu with its glimpse; auth pages stay chrome-free.
- **Regression.** Existing unit suite passes; capture/chat e2e specs updated to the new DOM
  keep their behavioral assertions.

Risk: **critical** — capture/ingest path (interpret, verbatim invariant, queue);
**high** — mesh/yarn/thought/chat surfaces; **normal** — feedback board (fixture), tokens.

Out of scope this pass: real board backend/votes persistence, Patterns LLM tuning beyond a
working cached judge, graph/embeddings/desk nav resurrection, new task system beyond the
to-do tick, MCP contract changes.
