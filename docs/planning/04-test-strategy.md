# Eigen Test Strategy (Unit / Integration / E2E)

## Strategy Objectives
- Protect critical user flows (capture, retrieval, pricing transparency, isolation).
- Enforce deterministic behavior (routing, retries, error surfaces).
- Prevent regressions in no-fallback policy.

## Test Layers and Ownership

### Unit Tests (Backend + Domain Logic)
Owner: backend/domain implementation

Priority scope:
- Intent classification routing decision (default vs relation-centric).
- Context selection score calculation:
  - default `0.7 vector + 0.3 graph`
  - relation `0.4 vector + 0.6 graph`
- Retry controller enforces exactly 3 retries.
- Pricing calculator:
  - base + 20% markup + total.
- Capture state machine (submit persists once, edit updates target thought only).
- browser `browser-whisper` adapter:
  - deterministic transcription pipeline handoff
  - device capability detection and unsupported-browser messaging
  - retry/error mapping for transcription failures

### Integration Tests (API + DB + Auth/RLS)
Owner: backend/platform implementation

Priority scope:
- Capture flow endpoint orchestration:
  - submit -> persist -> stored-result summary.
  - submit edit request -> targeted update -> updated stored-result summary.
- LLM gateway failure path:
  - retry exactly 3 times then terminal error.
- browser `browser-whisper` failure path:
  - retry exactly 3 times then terminal error.
- RLS isolation with `user_id`:
  - cross-user access denied for list/search/edit.
- MCP tool handlers:
  - `capture_thought`, `list_thoughts`, `search_thoughts`, `edit_thought`.
- Graph + vector retrieval combination using pgvector + AGE.
- Activity log write path for per-call costs and markup fields.

### End-to-End Tests (Playwright)
Owner: product/full-stack implementation

Priority scope:
- User capture journey:
  - enter text thought -> capture -> stored-result feedback.
  - submit voice note -> browser transcription via `browser-whisper` -> stored-result feedback.
  - submit natural-language edit request -> updated stored-result feedback.
- Error journey:
  - transcription or ingest dependency failure -> retries exhausted -> clear user-readable error.
- Retrieval journey:
  - default question path (vector-first + graph expansion).
  - relation-centric path (deferred; do not implement until requirements are re-opened).
- Transparency journey:
  - activity log shows call, base cost, markup, total.
- Security journey:
  - authenticated user sees only own data.

## Scenario Prioritization

### P0 (Release Blocking)
- Capture correctness (single-submit persist and deterministic update behavior).
- Voice transcription correctness with browser `browser-whisper`.
- No server-side transcription invariant.
- Ingest retry determinism (exactly 3) and terminal error behavior.
- Tenant isolation enforcement (`user_id` + RLS).
- Retrieval policy correctness for the default route class.
- Pricing transparency correctness (base/markup/total per call).

### P1
- MCP tool behavior consistency and idempotency expectations.
- Knowledge graph view correctness for representative data.

### P2
- Non-critical UX behavior and low-risk display details.

## Coverage Expectations by Risk
- Critical domain changes:
  - Must include at least one unit + one integration + one Playwright update.
- High-risk changes:
  - Must include integration coverage and either unit or E2E update.
- Normal changes:
  - Minimum unit or integration test based on touched area.

## Test Data and Environment Notes
- Use isolated test tenants (`user_id`) per test suite.
- Seed representative thought/relationship fixtures for graph+vector paths.
- Use deterministic mock/fake responses for LLM gateway failure scenarios.
- Track cost-log fixtures with explicit decimal assertions (base/markup/total).
