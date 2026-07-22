# Eigen Acceptance Criteria Catalog (MVP)

## Critical Paths

1. Capture (text/voice) -> Persist -> Stored-result summary -> Optional natural-language edit.
2. Retrieve (single default mode: vector-first) -> graph expansion -> LLM answer context selection.
3. MCP operations (`capture_thought`, `list_thoughts`, `search_thoughts`, `edit_thought`).
4. Transparent activity/cost logging with per-call markup visibility.
5. Deterministic LLM failure handling (3 retries then explicit error).
6. Tenant isolation by `user_id` with RLS.

> **Deferred:** relation-centric retrieval routing and its acceptance criteria are intentionally out of scope until re-opened as a requirement. The helper `selectRetrievalModeFromQuery` exists in code for a future router but is **not** invoked by production `search_thoughts` / HTTP retrieval paths until that deferral is lifted.

## Acceptance Criteria (Given/When/Then)

### AC-001 Capture submit persists immediately

- Given a signed-in user enters a raw text thought in capture UI
- When the user submits
- Then the system persists the thought exactly once and returns a natural-language summary of the stored result.

### AC-002 Voice capture uses browser-side transcription

- Given a signed-in user submits voice input
- When ingest runs
- Then browser-side transcription converts audio to text before metadata extraction/classification/embedding.

### AC-003 No server-side transcription

- Given a voice capture request
- When the capture flow runs
- Then Eigen backend does not execute audio transcription and only receives transcript text plus runtime metadata.

### AC-004 Natural-language edit after storage

- Given a thought has been stored
- When the user submits a natural-language edit request
- Then only the targeted thought is updated and the updated stored-result summary is returned.

### AC-005 Deterministic no-fallback transcription failures

- Given browser transcription dependencies fail
- When ingest runs
- Then the system retries exactly 3 times and returns a clear terminal error with no silent fallback.

### AC-006 Post-commit edits through MCP tool

- Given a committed thought exists
- When an authorized client invokes `edit_thought`
- Then only the targeted thought is updated and change is auditable.

### AC-007 MCP capture tool

- Given an authorized MCP client
- When it invokes `capture_thought`
- Then the system stores the thought and returns a success response with thought identifier.

### AC-008 MCP list tool

- Given an authorized MCP client
- When it invokes `list_thoughts`
- Then it receives a deterministic list scoped to the caller tenancy.

### AC-009 MCP semantic search tool

- Given an authorized MCP client and query text
- When it invokes `search_thoughts`
- Then relevant thought candidates are returned using vector + graph context policy.

### AC-010 Retrieval router default mode (active)

- Given a non-relation-centric query
- When retrieval runs
- Then vector + lexical + precomputed graph artifacts are merged in `retrieveEvidence`, followed by optional LLM listwise rerank when top scores are close (see [`docs/repo-map/retrieval.md`](../repo-map/retrieval.md)).

### AC-011 Retrieval router relation mode (deferred)

- Given a relation-centric query intent
- When retrieval runs
- Then graph-first retrieval path is used while incorporating vector evidence.

### AC-012 Context selection policy (default)

- Given default retrieval mode and candidate set
- When context is selected
- Then ranking uses a deterministic **weighted linear merge** (`SCORE_WEIGHTS` in `retrieve-evidence.ts`: thoughtSim 0.42, communitySim 0.25, entitySim 0.10, centrality 0.08, specificity 0.05, salience 0.04, recency 0.06). Graph/community/salience bonuses apply only when the candidate also has a direct vector or lexical hit. Reciprocal rank fusion is legacy and not used at query time.

### AC-024 Retrieval quality telemetry (metadata-only)

- Given a successful `search_thoughts` or equivalent hybrid search
- When results are returned to the caller
- Then the system may persist one **metadata-only** row (numeric channel diagnostics, weights, `top_k`, call surface) scoped by `user_id` with RLS, and **must not** store query text, normalized thought text, thought ids, or embeddings in that row.

### AC-013 Context selection policy (relation-centric) (deferred)

- Given relation-centric retrieval mode and candidate set
- When context is selected
- Then ranking uses `0.4 vector + 0.6 graph` deterministically.

### AC-014 Transparent pricing display

- Given an LLM/API call is made (including gateway calls)
- When call accounting is persisted
- Then base cost, markup amount, and total cost are visible to the user in activity log.

### AC-015 Per-call markup policy

- Given pricing is computed for a billable call
- When total is calculated
- Then a 20% markup is applied and displayed explicitly.

### AC-016 Deterministic LLM retry policy

- Given an LLM call fails transiently on the gateway
- When the call is retried
- Then system retries up to exactly 3 times for the same model and endpoint and no more.

### AC-017 Final user-facing error after retries

- Given all 3 LLM retries fail
- When failure is finalized
- Then user receives a clear, easy-to-understand error with no silent fallback.

### AC-023 No cross-model fallback on failure

- Given all 3 retry attempts for a model fail
- When retry budget is exhausted
- Then system returns an explicit error and does not switch to a different model family.

### AC-018 Tenant isolation

- Given two users with different `user_id`
- When each performs list/search/capture operations
- Then each user can only access their own records under RLS policies.

### AC-019 Better Auth protected endpoints

- Given an unauthenticated caller
- When it accesses protected mutation or retrieval endpoints
- Then access is denied consistently.

### AC-020 Performance target text capture

- Given typical system load
- When text capture is submitted
- Then p95 response time is <= 8 seconds.

### AC-021 Performance target voice capture

- Given typical system load
- When voice capture is submitted and transcribed in the browser
- Then p95 response time is <= 12 seconds.

### AC-022 Performance target retrieval

- Given typical system load
- When retrieval is requested
- Then p95 response time is <= 8 seconds.

### AC-025 Unified Q&A with grounding profile and cited compose (active)

- Given a signed-in user with a `user_grounding_profile` and/or stored thoughts
- When `composeAnswer` receives any query (local or global scope)
- Then retrieval uses `retrieveEvidence` via `searchThoughts`, injects the grounding profile when present, and the answer is composed with strict `Answer` / `Evidence` / `Unknown` sections and citations (`[id=<uuid>]` or `[id=profile]`). Community summaries are routing hints only — never the sole answer source.

### AC-026 Global-scope Q&A uses broader retrieval (active)

- Given a query classified as `global` scope
- When `composeAnswer` runs
- Then it uses a higher `topK`, fetches non-authoritative community theme hints for the compose prompt, and still returns cited thought- or profile-based answers (never uncited map-reduce synthesis).
