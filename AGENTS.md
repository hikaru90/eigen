## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: eslint, vitest, playwright, tailwindcss, sveltekit-adapter, drizzle, better-auth, paraglide, mdsvex

## UI components (shadcn-svelte)

- **Prefer the registry over hand-built UI.** Before implementing menus, overlays, popovers, dialogs, sheets, comboboxes, etc. with raw markup, native controls (`<details>`), or custom click-outside / focus logic, **check [shadcn-svelte components](https://www.shadcn-svelte.com/docs/components)** and existing primitives under `src/lib/components/ui/`.
- **Install missing pieces** with the official CLI (e.g. `npx shadcn-svelte@latest add popover`) instead of reimplementing accessibility, focus trap, and dismiss-on-outside behavior by hand.

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
- **Persist on submit:** the thought is stored immediately; there is no separate “preview then explicit accept” gate as the default path.
- **Feedback after write:** return a clear, natural-language summary of how the thought was stored (type/category, normalized text, key metadata as applicable).
- **Corrections after persistence:** the user may submit natural-language edit requests from the UI (and later via MCP) to update the stored thought; do not rely on implicit re-capture to rewrite committed rows.
- **MCP:** post-commit changes continue to go through explicit MCP edit tools where applicable.

## Ontology Policy
- Do not run an onboarding interview at first-use for ontology setup.
- Start from a simple baseline ontology (thought/task/idea/reference/date/person).
- Re-evaluate ontology after 10 captured thoughts (subject to acceptable compute cost).

## Security Baseline
- Use Better Auth.
- Enforce tenant isolation with Row Level Security.
- Use `user_id` as the tenancy key for isolation in MVP.

## Memory indexing and tool hygiene
- **Lexical recall:** persist a deterministic **precomputed search surface** on each thought (e.g. `thought.lexical_text`: NFKC-folded, lowercased, whitespace-collapsed from normalized body). Use it to build `tsvector` and/or BM25-style keyword retrieval alongside `pgvector`, so short phrases, names, and codes are not lost to embedding-only search.
- **Strict MCP / ingest contracts:** validate entity IDs (non-empty after trim, no interior whitespace), numeric bounds such as search `threshold` in `[0, 1]` and non-negative integer `top_k`, and reject ambiguous argument shapes at the boundary before any DB or LLM work.
- **Observability without leaks:** when logging or emitting telemetry for tool calls, configs, or errors, run payloads through a **secret redaction** pass (keys like `api_key`, `*_token`, `*_secret`, `password`, etc.) so usage transparency never ships raw credentials.

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
