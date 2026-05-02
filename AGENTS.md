## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: eslint, vitest, playwright, tailwindcss, sveltekit-adapter, drizzle, better-auth, paraglide, mdsvex

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
- Maintain a transparent usage log of relevant actions/API calls (including EUrouter calls).
- Display per-call cost details to users in understandable terms.
- Apply markup per call (initial default: 20%) and show markup explicitly.

## Failure Policy (Non-Negotiable)
- No fallbacks.
- No silent degradation paths.
- No temporary bypasses to "keep things working."
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

## Capture Review Loop
- After ingest input, return a structured preview to the user before persistence:
  - Captured type/category.
  - Normalized thought text.
  - Key metadata.
- User can request revisions in a multi-turn loop until satisfied.
- Thought is persisted only on explicit user acceptance.
- After commit, edits are handled through explicit MCP edit tools (not implicit capture rewrites).

## Ontology Policy
- Do not run an onboarding interview at first-use for ontology setup.
- Start from a simple baseline ontology (thought/task/idea/reference/date/person).
- Re-evaluate ontology after 10 captured thoughts (subject to acceptable compute cost).

## Security Baseline
- Use Better Auth.
- Enforce tenant isolation with Row Level Security.
- Use `user_id` as the tenancy key for isolation in MVP.

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
- Coverage is enforced by risk, not by a single blanket threshold.
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
