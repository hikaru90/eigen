# Eigen Guardrails and Quality Gate Policy

## Definition of Ready (DoR)
A change is Ready only when all items below are satisfied:
- Requirement is documented and scoped (in/out boundaries clear).
- Acceptance criteria exist in Given/When/Then form.
- Risk classification is assigned (`critical`, `high`, `normal`).
- API/data contracts are written for touched surfaces.
- Failure modes are documented with deterministic behavior.
- Test cases are drafted for unit, integration, and E2E layers.
- Security impact is reviewed (auth, tenancy, RLS implications).

## Definition of Done (DoD)
A change is Done only when all items below are satisfied:
- Unit, integration, and Playwright E2E tests are implemented and passing.
- Critical-path scenarios for touched domains are passing.
- No unresolved high-severity defects.
- Behavior changes are documented in contract docs.
- No forbidden fallback/silent degradation behavior introduced.

## Risk Classification Rules
- `critical`:
  - Ingest flow, retrieval routing, context selection, tenancy/RLS, auth, pricing/cost accounting.
  - Must include regression tests and release-blocking checks.
- `high`:
  - MCP tools, non-core UI screens, schema migrations touching production paths.
- `normal`:
  - Non-critical UI polish and low-risk refactors.

## Coverage Thresholds
- Coverage is enforced by risk tier with explicit thresholds:
  - Critical tier: 95% lines/branches/functions/statements.
  - High tier: 80% lines/branches/functions/statements.
  - Normal tier: 80% lines/branches/functions/statements.
- Tier glob mapping for CI thresholds:
  - Critical: `src/lib/server/{capture,retrieval,llm,pricing,validation,observability,memory,ingest,activity}/**`
  - High: `src/lib/server/{graph,db}/**`, `src/lib/server/auth.ts`, `src/lib/server/auth-form-errors.ts`, `src/routes/**/+server.ts`, `src/routes/**/+page.server.ts`, `src/routes/+layout.server.ts`
  - Normal: `src/lib/components/**/*.svelte`, `src/routes/**/*.svelte`
- Exclusions: generated outputs and scaffolding (`src/lib/paraglide/**`, `src/lib/server/db/auth.schema.ts`, `src/routes/demo/**`, config files, and other non-runtime assets).
- Coverage report path: `coverage/index.html`.

## Merge Gates (PR-Level)
- All required tests pass for impacted risk level.
- Lint/type checks pass.
- No security policy regressions (Better Auth + RLS).
- PR references relevant requirement IDs and acceptance criteria.
- For critical changes, at least one explicit critical-path test update is present.

## Release Gates
- All critical-path E2E scenarios pass.
- Deterministic retry behavior validated:
  - Exactly 3 retries for each LLM call (same model and endpoint).
  - Clear terminal error after retry budget is exhausted.
- Retrieval routing behavior validated for the default intent class (relation-centric deferred).
- Transparent pricing behavior validated:
  - Base cost, markup, total visible and coherent.
- No fallback paths or silent degradation introduced.

## Non-Negotiable Guardrails
- No fallbacks.
- No silent degradation.
- No hidden bypasses.
- Deterministic behavior for failure and routing decisions.
- Capture persists immediately on submit by default; corrections happen through explicit post-commit edits.
- No cross-model fallback when retry budget is exhausted.
- Tenant isolation by `user_id` enforced with RLS.
- Immediate pgvector + AGE combination retained as core behavior.
- **Lexical surface:** each committed thought maintains a deterministic `lexical_text` (or equivalent) for Postgres full-text / keyword fusion with vectors; stem or lemmatize only behind an explicit, tested pipeline.
- **MCP and ingest boundaries:** validate IDs and search parameters at the tool/API edge; document contracts in the MCP spec.
- **Logging and telemetry:** structured logs and cost traces must redact secret-shaped fields; never persist raw API keys in the activity log payload.

## Change Control for Core Policies
Any change to these requires explicit requirement update before implementation:
- Retry count policy (currently 3).
- Context selection weights.
- Tenant key model (`user_id`).
- Pricing markup policy (currently 20% per call).
- MCP v1 tool set surface.
