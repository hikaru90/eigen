# Eigen Implementation Roadmap (Post-Testing)

## Objective
Define implementation sequencing after the testing baseline and coverage gates are in place.

## Milestone A — Auth, Tenancy, and RLS Hardening
- Validate Better Auth session boundaries across all protected endpoints.
- Add integration tests that explicitly assert tenant isolation using `user_id`.
- Add Playwright critical-path checks for authenticated and unauthenticated journeys.

## Milestone B — Capture and Edit Pipeline Productionization
- Replace MVP stub pricing usage in capture flow with gateway-backed accounting where required.
- Keep submit persistence deterministic and single-write (`AC-001`).
- Keep post-commit natural-language edit behavior explicit and auditable (`AC-004`).

## Milestone C — MCP v1 Surface Completion
- Finalize and validate contracts for:
  - `capture_thought`
  - `list_thoughts`
  - `search_thoughts`
  - `edit_thought`
- Ensure strict argument validation at the boundary and stable error responses.

## Milestone D — Retrieval and Context Selection Hardening
- Complete integration coverage for vector-first retrieval with graph expansion.
- Assert deterministic context scoring policy (`0.7 vector + 0.3 graph`) for default mode.
- Add RLS-aware retrieval tests to ensure cross-tenant isolation in candidate selection.

## Milestone E — Activity and Cost Transparency UI
- Ensure base cost, markup, and total are persisted and visible per call.
- Validate activity log rendering for latest calls and edge states (empty, partial metadata).
- Add coverage for redaction and secret hygiene in logs/telemetry payloads.

## Milestone F — Knowledge Graph View
- Ship graph visualization for captured thought relationships.
- Validate graph writes from capture submit/edit are represented correctly.
- Add tests for graph-specific edge cases (missing nodes, sparse graph, large fan-out).

## Milestone G — P0 E2E Suite Completion
- Complete Playwright P0 scenarios from test strategy:
  - capture correctness (text + voice path contracts),
  - retry exhaustion and explicit failure messaging,
  - transparency log visibility,
  - authenticated data isolation.

## Exit Criteria
- Critical-path tests pass in CI.
- Coverage gates satisfy tier thresholds (critical 95%, high/normal 80%).
- No unresolved high-severity defects in critical domains.
