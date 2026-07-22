# Eigen Pre-Coding Milestones and Entry Criteria

## Milestone 1 — Requirements Freeze (MVP)

Objective:

- Freeze MVP scope and non-goals for first implementation cycle.

Deliverables:

- `01-requirements-baseline.md`
- `02-acceptance-criteria.md`

Exit criteria:

- MVP in-scope/out-of-scope list approved.
- Critical paths approved.
- Acceptance criteria approved.

## Milestone 2 — Quality and Guardrails Freeze

Objective:

- Freeze quality bar and non-negotiable engineering guardrails.

Deliverables:

- `03-guardrails-quality-gates.md`

Exit criteria:

- DoR/DoD approved.
- Risk-based merge/release gates approved.
- No-fallback + deterministic retry policy approved.

## Milestone 3 — Test Strategy Freeze

Objective:

- Freeze test-layer responsibilities and release-blocking scenarios.

Deliverables:

- `04-test-strategy.md`

Exit criteria:

- Unit/integration/Playwright strategy approved.
- P0 release blockers explicitly accepted.
- Ownership per test layer clear.

## Milestone 4 — Implementation Readiness

Objective:

- Confirm all pre-coding contracts and execution checklist are complete.

Required decisions confirmed:

- Core stack: SvelteKit, Drizzle, PostgreSQL, pgvector, AGE, Better Auth, Playwright, shadcn-svelte.
- Retrieval policies:
  - vector-first default
  - graph-first relation mode
  - context selection weights (`0.7/0.3`, `0.4/0.6`)
- Tenancy/security:
  - `user_id` + RLS
- Failure policy:
  - exactly 3 retries per LLM call then clear error
  - no cross-model fallback on retry exhaustion
- Pricing:
  - per-call cost logging + 20% markup display

Exit criteria:

- Implementation checklist approved.
- Initial build backlog generated from checklist items.
- Team/user gives explicit "implement now" go-ahead.

## Execution Sequence (Post-Milestone)

1. Bootstrap project and database foundation.
2. Implement auth + tenancy + RLS.
3. Implement capture submit + natural-language edit loop.
4. Implement MCP v1 tools.
5. Implement retrieval router and graph+vector context selection.
6. Implement activity/cost log and pricing transparency.
7. Implement knowledge graph view.
8. Complete P0 tests and release gates.
