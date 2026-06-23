# Domain: Nightly consolidation (sleep)

**Entrypoint:** per-user jobs in `user_job_queue`, drained by the global in-app ticker.

**Schedule:** per-user row in `user_scheduled_task` (default 2:00 AM UTC). The ticker enqueues due overnight jobs and processes pending queue items for **production** users every 60 seconds. Harness tenants (`account_kind = harness`: eval `@local.eval`, e2e `@test.eigen`) are excluded from automatic overnight scheduling.

## Sleep phases

| Phase | Analog | Jobs |
|-------|--------|------|
| **DeepSleep** | Slow-wave / declarative + pruning | `salience_compute`, `ontology_prune`, `repair_canonical_entity_types`, `dedup_canonical_entities`, `repair_entity_relations` |
| **REM** | Integration + procedural | `community_detection`, `community_summaries` |

Orchestrator: [`src/lib/server/consolidation/runner.ts`](../../src/lib/server/consolidation/runner.ts)

Per-user work runs inside `withDbUser` so RLS applies.

## Awake vs asleep

- **Awake:** capture enrichment, retrieval reconsolidation (salience bumps on access), ontology profile refresh every 10th thought.
- **Asleep:** overnight consolidation via `user_job_queue`; salience decay/open-loop floors recomputed from **elapsed wall-clock time** (not per-run ticks).

## Community contract

- Community detection clusters over **`ENTITY_RELATES`** graph edges only (`edgePolicy: entity_relates_only`); co-mention edges are visualization support, not clustering input.
- Level semantics are fixed:
  - `L3` leaf = tight operational groups
  - `L2` = sub-domain thematic lanes
  - `L1` = domain-level structure
  - `L0` root = broad worldview partitions
- Before writing communities, detection computes graph-health diagnostics (components, isolation ratio, relation density) and marks low-confidence runs when relation structure is too weak.

## Job queue tables

| Table | Purpose |
|-------|---------|
| `user_scheduled_task` | Per-user schedule (`run_hour`, `run_minute`, `timezone`, `paused`) |
| `user_job_queue` | Pending/running/completed work (`overnight_consolidation`, …) |

Global ticker: [`src/lib/server/job-queue/ticker.ts`](../../src/lib/server/job-queue/ticker.ts) (started from [`hooks.server.ts`](../../src/hooks.server.ts)).

Manual tick: `npm run db:cron`

## Verify queue health

```sql
SELECT user_id, job_type, status, run_after, dedupe_key
FROM user_job_queue
ORDER BY created_at DESC
LIMIT 20;

SELECT user_id, run_hour, run_minute, timezone, paused, last_enqueued_night
FROM user_scheduled_task;
```

Settings → **Heartbeat** shows schedule from `user_scheduled_task` and last run from `heartbeat_run`.

## Manual trigger (session)

Use Settings → **Heartbeat** → **Run now**, or:

```bash
curl -sf -X POST "$ORIGIN/api/scheduled-tasks/eigen-sleep-consolidation" \
  -H "Cookie: <session>"
```

Admin bulk endpoint [`POST /api/admin/consolidate`](../../src/routes/api/admin/consolidate/+server.ts) remains for operator use with `X-Admin-Key`.

## Follow-ups (not implemented)

- `ontology_proposal` generation from clustering
- Declarative fact merging
- Stale community summary refresh when `community.updatedAt > summary.generatedAt`
- Persist graph edge fingerprint at detection time for finer staleness (same entity IDs, rewired edges)
