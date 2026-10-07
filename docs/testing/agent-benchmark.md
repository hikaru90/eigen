# Agent Benchmark (DoD gate)

**Principle (operator, 2026-10-06): agent usability is the benchmark for every
feature.** If an agent cannot drive a feature end-to-end through the MCP tool
surface within a bounded number of round-trips — including cleanup — the
feature is not done.

## The gate (per feature, before merge)

1. **Drivable**: the feature is reachable and completable using only MCP tools
   (`eigen_*`) — no UI-only features, no hidden endpoints required.
2. **Round-trip budget**: the common flow completes within the budget declared
   in the feature's requirements (default: ≤ 5 tool calls for the happy path).
3. **Reads tell the truth**: tool responses reflect post-enrichment reality, or
   explicitly mark provisional fields (see `categoryProvisional`).
4. **Errors are actionable**: invalid input fails loud with the exact constraint
   (e.g. `Invalid threshold: 5. Must be between 0 and 1 (inclusive)`). No silent
   fallbacks.
5. **Cleanup works**: anything the test-drive created (projects, thoughts,
   milestones) can be removed through tools, and removal is verified.

## The test-drive (run it against a scratch project, then delete it)

1. `eigen_list_projects` — answers "what should I work on?" in one call.
2. `eigen_create_project` → `eigen_set_project_deadline` → `eigen_set_project_milestone`.
3. `eigen_capture_thought` (an explicit TODO) → `eigen_order_task_in_project`.
4. `eigen_get_project_timeline` — verify membership + ranks.
5. `eigen_edit_thought` "mark as done" → timeline shows the task pruned.
6. `eigen_delete_thought` + `eigen_delete_project` → `eigen_list_projects` confirms clean.
7. One negative probe per contract (e.g. out-of-range `threshold`) — must fail
   loud with the constraint in the message.

## Regression watchlist (agent-trust data quality)

These data defects break agent trust even when tools behave; check them when
touching the project/enrichment pipeline:

- duplicate project hubs (label variants) — the reconcile LLM judge must see
  manual projects (winner-only) and capture projects alike
- the same task in two waterfalls — explicit ordering is a move
- misclassified open tasks (completed-work notes, statements, memory requests)
- capture-time category contradicting the post-enrichment category

## History

- 2026-10-06: first live benchmark scored GTD projects 7/10 (contracts 9,
  round-trips 7, lifecycle 9, data trust 5). Fixes: reconcile manual
  inclusion, single-waterfall ordering, `categoryProvisional`, stalled-signal.
