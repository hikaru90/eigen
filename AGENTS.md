## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: eslint, vitest, playwright, drizzle, better-auth, paraglide, mdsvex

## Not live — prefer clean code over accretion

This project is **not in production** and is **not serving live users**. Agents must not treat the codebase as a fragile production system that can only grow by appending.

- **Prefer delete-and-replace over append-only.** When a problem needs a clean slate, delete obsolete functions, modules, and call paths. Do not keep dead layers “just in case” or stack new helpers on top of the wrong design.
- **Greenfield is allowed for scoped areas.** Parts of this repo (a feature surface, a pipeline stage, a UI flow) may be treated as greenfield when the correct fix is a rewrite, not another patch. Prefer the simplest correct shape over preserving historical structure.
- **Refactor aggressively when it serves the goal.** Heavy deletion and restructuring are welcome when they produce cleaner, more coherent code — still keep changes scoped to the problem being solved, update tests accordingly, and do not casually break unrelated systems.
- **Do not default to “build on top.”** Accretion (wrapper → wrapper → flag → special case) is the wrong default here. If the existing approach is wrong, replace it.

## Testing (run and enforce)

- **How to run / what CI gates:** [`docs/testing/README.md`](docs/testing/README.md)
- **TDD (mandatory for features/fixes/plans):** define end goal → write unit tests + headed Playwright (`test:e2e:release:headed`) **first** → only then implement → code until green / nothing else broke. Skill: [`.cursor/skills/tdd-tests-first/SKILL.md`](.cursor/skills/tdd-tests-first/SKILL.md).
- **Unit suite:** `npm run test:unit` (or `npm run test:coverage` for a report + threshold check).
- **CI:** `.github/workflows/test-coverage.yml` runs lint, check, and **`test:unit`** on every PR (merge gate). Coverage is reported in the same workflow but is not yet required until tier thresholds are met.
- **E2E / evals:** operator-owned; see testing README and the eval section below. Do not skip the unit suite because evals exist.

## Database migrations (agent — non-negotiable)

Every schema change needs **both** a SQL file and a journal entry in the **same change**. Never one without the other.

1. Add `drizzle/NNNN_name.sql`.
2. Append matching `tag` to `drizzle/meta/_journal.json` (`idx` sequential, `tag` = filename without `.sql`).
3. Update Drizzle schema in `src/lib/server/db/`.
4. Run `npm run db:migrate` and confirm it applies.

`scripts/migrate.mjs` **fails fast** if any SQL file is missing from the journal; deploy will skip the migration and runtime queries against new columns will 500. See [`.cursor/rules/drizzle-migration-journal.mdc`](.cursor/rules/drizzle-migration-journal.mdc).

## UI components (shadcn-svelte)

- **Prefer the registry over hand-built UI.** Before implementing menus, overlays, popovers, dialogs, sheets, comboboxes, etc. with raw markup, native controls (`<details>`), or custom click-outside / focus logic, **check [shadcn-svelte components](https://www.shadcn-svelte.com/docs/components)** and existing primitives under `src/lib/components/ui/`.
- **Install missing pieces** with the official CLI (e.g. `npx shadcn-svelte@latest add popover`) instead of reimplementing accessibility, focus trap, and dismiss-on-outside behavior by hand.

## Svelte: no `$effect` for control flow (non-negotiable)

- **Do not use `$effect`** (or `$effect.pre`) when the work can be done with a deterministic event: `onMount` / page load, click/submit handlers, form actions, store `subscribe` in `onMount` with explicit cleanup, or a function called after a mutation completes.
- **Preferred pattern:** on page load → fetch once; on user action (e.g. checkmark) → save → fetch the updated list. Fail and succeed on those boundaries — not on reactive “something changed” cascades.
- **`$derived` / `$derived.by` are fine** for pure computed view state from existing data. That is not control flow.
- **Forbidden anti-pattern:** `$effect(() => { void someKey; void fetch(...) })`, `$effect` writing to `localStorage`, `$effect` syncing props into local state, `$effect` opening/closing dialogs because a prop flipped. Those hide causality and cause duplicate fetches / non-deterministic prod behavior.
- **If you think you need `$effect`:** stop and wire an explicit event or call site instead. React-style “sync in useEffect” thinking does not belong here — this is SvelteKit.

## Repository map (orientation)

- For **scoped ownership** of ingestion, retrieval, auth, and UI—and for **documented overlaps** between systems—read [`docs/repo-map/index.md`](docs/repo-map/index.md) before architecture-heavy answers or cross-cutting edits. Open contradictions are listed in [`docs/repo-map/conflicts.md`](docs/repo-map/conflicts.md). Update the smallest affected layer when behavior changes ([`docs/repo-map/maintenance.md`](docs/repo-map/maintenance.md)).

## Working with the user (diagnose before fixing)

The user values being heard and understood over speed. A real fix starts with a shared understanding of what went wrong — reached through conversation, not a rushed patch. Follow this whenever the user reports that something is broken, wrong, or low quality.

### Structured investigation (no guessing)

Do **not** change code at random and hope it sticks. When tackling a problem — especially production outages, missing notifications, queue issues, or “it doesn’t work” — follow this order:

1. **Map the system** — Which subsystems are in the path? (e.g. pg_cron → pg_net → HTTP endpoint → dispatch logic → push subscription → device.) Name them from code/docs, not from assumptions.
2. **Get visibility first** — Identify what observability already exists (logs, SQL tables, admin endpoints, UI). Ask for or query **evidence** before theorizing. Distinguish “job was queued” from “request succeeded” from “notification was delivered.”
3. **State known facts vs unknowns** — Separate what the logs/data prove from what still needs checking. Do not present hypotheses as root cause.
4. **Agree on diagnosis** — Explain which layer failed and why, with citations. Wait for the user to confirm or supply missing data before implementing.
5. **Plan the fix** — One targeted change (or minimal set) that addresses the confirmed failure layer. No drive-by refactors, no piling on “while we’re here” hardening unless agreed.
6. **Verify** — Define how we’ll know it worked (specific log line, query result, UI action). Run only the smallest relevant tests.

**Forbidden:** shipping multiple speculative fixes (logging + cron + secrets + UI) without evidence; treating partial logs as proof of success; skipping straight to implementation when the user asked what went wrong.

- **When the user expresses frustration or says the work was bad, treat that as a signal to slow down, not speed up.** Acknowledge the frustration sincerely (briefly, without groveling) and make clear you are taking it seriously. The user is not being mean — they genuinely want an answer.
- **Diagnose and explain root cause first. Do not jump to a plan or to code.** When the user pastes a log, a bad output, or a specific problem, your first job is to investigate and explain _which system failed and why_, citing the actual files and lines. Name the failing layers in order of severity. Only propose a fix after the user has the explanation and agrees on the diagnosis.
- **Do not confuse a request to understand with a request to implement.** "This is bad / what went wrong?" means _explain it to me first_. Wait for the user to explicitly ask for a plan or for execution before producing one.
- **Answer the actual question.** If the user asks "what went wrong?", deliver a direct, thorough answer to that question — not a redirect, not a summary, not a plan. Match the depth of the request.
- **Generalize the problem.** A single bad output is evidence of a bug _class_, not a one-off to paper over. Understand the underlying failure so the fix holds for every input, per the no-fallbacks and generalize-ingest-fixes guardrails below.

---

# Project Guardrails: Test-First SvelteKit Open Brain

## Scope

- This is a universal SvelteKit project (frontend + backend).
- Product model is Open Brain style memory infrastructure, not a traditional notes UI.
- Do not start feature implementation until requirements, guardrails, and test design are approved.
- Use Drizzle as the ORM.
- Use Playwright for end-to-end testing.
- Use shadcn-svelte for UI components.
- Use native client-side fetch against explicit `+server` endpoints as the default write/mutation pattern.
- Use pgvector and Apache AGE together from day one as a core feature (no phased graph deferment).

## Primary Goals

- Ensure clear, complete, testable requirements.
- Enforce a strong test strategy before coding.
- Keep thought capture as the center-stage interaction.
- Maximize user trust through cost and infrastructure transparency.

## Pricing Transparency Policy

- Do not hide infrastructure costs behind opaque subscription-only pricing.
- Maintain a transparent usage log of relevant actions/API calls (including LLM gateway calls).
- Display per-call cost details to users in understandable terms.
- Apply markup per call (initial default: 20%) and show markup explicitly.

## Failure Policy (Non-Negotiable)

- No fallbacks.
- No silent degradation paths.
- No temporary bypasses to "keep things working."
- No implicit defaults for required runtime config (for example `|| 'localhost'`, default ports, default graph names, or fallback credentials).
- Deterministic retry policy for ingest dependencies: retry up to exactly 3 times in background, then fail with an explicit, easy-to-understand error.
- Prefer hard failure over hidden behavior changes.

## Mandatory Pre-Coding Requirements

- Every feature must have:
  - A written requirement with explicit in-scope/out-of-scope boundaries.
  - Testable acceptance criteria in Given/When/Then format.
  - A risk classification (`critical`, `high`, or `normal`).
  - Planned test coverage across unit, integration, and E2E layers.

## Core Interaction Model

- Primary user action: submit a raw thought to an ingest endpoint.
- The user should not be required to manually structure, tag, or categorize thoughts during capture.
- Ingestion pipeline must autonomously perform:
  - Metadata extraction.
  - Categorization/classification.
  - Vector embedding generation.
  - Persistence in the thought store.
- Post-capture interaction happens mainly through MCP tools (not dashboard-heavy manual CRUD flows).

## Capture flow (default)

- **UI path — interpret → confirm → ingest:** On Capture, submit runs an LLM **interpret** pass (`POST /api/capture/interpret`) that drafts `interpretedText` + category + memoryType + entity preview. The row is persisted with `enrich_queue_status=awaiting_confirmation` and **enrich is not scheduled**. The user must **Confirm** (`POST /api/capture/confirm`) or **Correct** in natural language (`POST /api/capture/correct`) before full ingest (embed + entities + relations + temporal + GTD).
- **Verbatim invariant:** `thought.raw_text` remains the user’s submitted text; confirm writes the accepted interpreted text to `normalized_text` only.
- **MCP / eval / agent:** Still use `captureThought` without the confirmation gate (persist + schedule enrich, or `awaitEnrichment` for tests).
- **Feedback after confirm:** Structured stored summary + background indexing status; corrections after persistence continue via natural-language edit (`/api/capture/edit` / MCP `edit_thought`).
- **MCP:** post-commit changes continue to go through explicit MCP edit tools where applicable.

## Ontology Policy

- Start from a simple baseline ontology (seeded silently on first load — no manual ontology setup).
- **Optional grounding profile:** users may answer occasional, dismissible questions on Capture that persist a `user_grounding_profile` used as supplementary enrichment context. Grounding never blocks capture, never replaces retrieval in Q&A, and is not required before first capture.
- Re-evaluate ontology labeling profile after 10 captured thoughts (subject to acceptable compute cost).

## Security Baseline

- Use Better Auth.
- Enforce tenant isolation with Row Level Security.
- Use `user_id` as the tenancy key for isolation in MVP.

## LLM as judge (no string heuristics)

- **Never** use regex, keyword lists, stop-word filters, substring rules, lexical folding, word overlap, prefix matching, or any static string analysis in application code to decide semantic meaning (entity type, category, intent, temporal scope, hint-to-event binding, contradictions, retrieval mode, edit routing, etc.). This applies in **every language** — do not substitute English- or German-specific string tricks for an LLM call.
- **Always** use an LLM call with ontology catalog + JSON schema for those decisions. See [`.cursor/rules/no-string-heuristics.mdc`](.cursor/rules/no-string-heuristics.mdc).
- Post-LLM code may parse JSON, validate contracts, trim whitespace, and persist — not re-type, re-route, or **match meaning** based on string patterns.
- **Examples of forbidden patterns:** `scoreEntityHintMatch`, parsing quoted phrases from questions, `.includes()` / `.startsWith()` to decide whether a hint refers to an event, capitalized-word heuristics, `foldLexicalChars` for semantic binding (folding is allowed only for **lexical search indexing**, not meaning).
- **Allowed without LLM:** embedding similarity for **retrieval ranking**, lexical indexing (`lexical_text`, tsvector, BM25), graph traversal on persisted structure, ID/format validation, redaction.

## GTD projects (LLM judge — non-negotiable)

A row in the **Projects** tab is a **GTD body of work**, not a graph entity that happens to be mentioned often.

- **Never** promote something to a GTD project using structural rules alone: mention/link counts, co-mention edges, entity–entity adjacency, ontology `entity_type` buckets (`organization`, `concept`, `artifact`, …), or “this hub has ≥ N linked thoughts.”
- **Always** use an **LLM judge** (ontology + JSON schema) to decide whether a hub is a multi-step initiative the user is running, with linked thought summaries and graph context as **input to the prompt** — not as a substitute for the judge.
- Graph entities (ingredients, people, products, book titles, domains, abbreviations) may be **mentioned** in capture and appear in the knowledge graph; that does **not** make them GTD projects. An LLM would reject “roasted garlic,” “schwester,” or “eu” as projects; code must not promote them because a counter crossed 2.
- **Forbidden:** bulk scans that insert `project_profile` for every entity passing a numeric threshold; treating co-mentioned entities from one capture as separate auto-projects; demoting/promoting based on string patterns or entity-type allowlists for **meaning**.
- **Required:** explicit LLM promotion/demotion (and merge/dedup of variants like Eigen/EigenMesh) before a hub appears in Projects; post-LLM code only validates JSON, persists, and relinks — it does not re-decide “is this a project?”
- **Regression tests** must include negative cases: ingredients, relatives, single tasks, and frequently co-mentioned concepts must **not** become GTD projects without a positive LLM promotion decision.

- **Lexical recall:** persist a deterministic **precomputed search surface** on each thought (e.g. `thought.lexical_text`: NFKC-folded, lowercased, whitespace-collapsed from normalized body). Use it to build `tsvector` and/or BM25-style keyword retrieval alongside `pgvector`, so short phrases, names, and codes are not lost to embedding-only search.
- **Strict MCP / ingest contracts:** validate entity IDs (non-empty after trim, no interior whitespace), numeric bounds such as search `threshold` in `[0, 1]` and non-negative integer `top_k`, and reject ambiguous argument shapes at the boundary before any DB or LLM work.
- **Observability without leaks:** when logging or emitting telemetry for tool calls, configs, or errors, run payloads through a **secret redaction** pass (keys like `api_key`, `*_token`, `*_secret`, `password`, etc.) so usage transparency never ships raw credentials.
- **Embeddings are DB-only:** vectors may be stored and used for retrieval, but must **never** appear in MCP tool results, agent/LLM messages, or logs. See [`docs/planning/embeddings-db-only-boundary.md`](docs/planning/embeddings-db-only-boundary.md). Use `sanitizeMcpToolResult` / `stripEmbeddingsFromValue` / `sanitizeChatMessages` ([`src/lib/server/observability/strip-embeddings.ts`](src/lib/server/observability/strip-embeddings.ts)); never `select()` embedding columns for tool-facing queries.

## Definition Of Ready (DoR)

- Requirement is unambiguous and approved.
- API/data contracts are defined.
- Edge cases and failure modes are documented.
- Unit, integration, and E2E test cases are drafted.

## Definition Of Done (DoD)

- Unit, integration, and E2E tests exist and pass.
- Critical-path scenarios pass in CI.
- No unresolved severity-high defects.
- Behavior and constraints are documented.

## Risk-Based Quality Gates

- Coverage is enforced by risk tier with explicit thresholds:
  - Critical tier: 95% (lines/branches/functions/statements)
  - High tier: 80% (lines/branches/functions/statements)
  - Normal tier: 80% (lines/branches/functions/statements)
- Canonical glob mapping for tiers lives in `docs/planning/03-guardrails-quality-gates.md` and is the source of truth for CI enforcement.
- Critical modules require:
  - Explicit critical-path regression tests.
  - Merge blocking if critical-path tests fail.
- Any change in critical domains must include regression updates.
- Ingestion and semantic retrieval are always critical-path domains.

## Required Deliverables Before Coding

- Requirements baseline (problem, goals, scope, personas, functional + non-functional requirements).
- Acceptance criteria catalog (Given/When/Then).
- Critical-path flow list.
- Test strategy (unit/integration/E2E scope and ownership).
- Risk matrix mapping features to required validation depth.
- CI quality gate policy for merge/release.
- Pre-coding milestone plan.
- Ingestion contract spec (input schema, extraction/classification expectations, embedding/storage guarantees).
- MCP interface spec (tool contracts for capture, list, search, and question-answer retrieval).

## Workflow

- Requirement -> acceptance criteria -> risk classification -> test planning -> approval -> implementation.
- Pull requests must reference requirement IDs and related test cases.

## Eval runs (agent)

- **Do not run Q&A evals** (`npm run eval`, `eval:smoke`, `eval:all`, or `evals/run.ts`). The operator validates from the **`/eval` UI**, not the CLI.
- **Do not tell the operator to run `npm run eval` or other eval npm scripts** for end-to-end validation. Point them to the UI instead:
  - **One catalog question:** `/eval` → **Questions & answers** → **Run** on the row (e.g. `qa_jonas_creative_silence`).
  - **Smoke or all questions:** `/eval` → **Runs** → choose run type → **Start run**.
  - **Clean corpus before a run:** `/eval` → **Runs** → **Reset corpus & start** (not `npm run eval -- --fresh-corpus`).
- After eval-related code changes, run **unit tests** only (e.g. `evals/harness/*.spec.ts`, `entity-extraction.spec.ts`) and tell the operator which **`/eval` UI action** to use.
- Diagnose from eval output the user pastes (or saved run detail in the UI); do not re-run evals to reproduce unless they explicitly ask.

## Agent debugging: root cause, not workaround

- When a **test or eval check fails**, fix the underlying bug (RLS, billing context, enrichment order, LLM config, stale corpus data). Do **not** weaken assertions, skip tests, or add heuristic/fallback paths to green the build. See [`.cursor/rules/fix-root-cause-not-workaround.mdc`](.cursor/rules/fix-root-cause-not-workaround.mdc) and [`no-fallbacks.mdc`](.cursor/rules/no-fallbacks.mdc).
- **Eval entity checks** depend on real `entity_resolution_log` rows from successful enrichment. Root fixes include: `activity_call_log` inserts under the RLS tenant (`tenantUserAsyncLocal`), eval re-enrich kicks with `billingUserId`, corpus reuse only maps fixtures after entity assert/reenrich, and LLM mention extraction with the existing retry pass (not regex bootstrap after `[]`).
- Add or update a **unit test** for each invariant you fix so the regression cannot return silently.

## Generalize ingest fixes (no thought-specific patches)

- Capture, enrichment, retrieval, and entity resolution must work for **every thought any user may ingest** — not only the thought currently in logs, eval output, or the operator’s session.
- A failing or noisy capture is **evidence of a bug class**, not a specification. Do **not** hardcode fixes keyed on a specific `thought_id`, exact normalized/raw text, eval catalog slug, or one-off corpus row.
- Do **not** add special-case branches like “if text contains X from this capture, do Y.” Prefer language-level rules, ontology contracts, token/span boundaries, and structural invariants that generalize.
- Unit tests may use concrete example strings to **illustrate** a class (e.g. German pronouns, substring false positives), but production code must not depend on those exact strings as the fix.
- If the only fix you can imagine is scoped to one thought, stop and redesign — the pipeline is wrong, not that thought.
