# Domain: Nightly consolidation (sleep)

**Entrypoint:** [`POST /api/admin/consolidate`](../../src/routes/api/admin/consolidate/+server.ts)

**Scheduler:** pg_cron + pg_net in Postgres ([`scripts/ensure-sleep-cron.mjs`](../../scripts/ensure-sleep-cron.mjs)), default `0 2 * * *` in `CONSOLIDATION_CRON_TZ` (UTC unless set).

## Sleep phases

| Phase | Analog | Jobs |
|-------|--------|------|
| **DeepSleep** | Slow-wave / declarative + pruning | `salience_decay`, `ontology_prune`, `repair_canonical_entity_types` |
| **REM** | Integration + procedural | `community_detection` (conditional), `community_summaries`, `open_loop_salience` |

Orchestrator: [`src/lib/server/consolidation/runner.ts`](../../src/lib/server/consolidation/runner.ts)

Per-user work runs inside `withDbUser` so RLS applies.

## Awake vs asleep

- **Awake:** capture enrichment, retrieval reconsolidation (salience bumps on access), ontology profile refresh every 10th thought.
- **Asleep:** nightly consolidation above; idempotent global run tracked in `consolidation_run`.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `ADMIN_CONSOLIDATION_KEY` | Yes (for cron) | `X-Admin-Key` on consolidate endpoint |
| `DATABASE_ADMIN_URL` | Yes (for cron bootstrap) | Superuser URL for pg_cron schedule + run ledger |
| `CONSOLIDATION_INTERNAL_URL` | Yes (compose) | App URL reachable from DB (`http://app:3000`) |
| `CONSOLIDATION_CRON_SCHEDULE` | No | Cron expression (default `0 2 * * *`) |
| `CONSOLIDATION_CRON_TZ` | No | IANA timezone for schedule + run-night idempotency (default `UTC`) |

## Manual trigger

```bash
curl -sf -X POST "$ORIGIN/api/admin/consolidate" \
  -H "X-Admin-Key: $ADMIN_CONSOLIDATION_KEY" \
  -H "Content-Type: application/json"
```

Single user:

```bash
curl -sf -X POST "$ORIGIN/api/admin/consolidate" \
  -H "X-Admin-Key: $ADMIN_CONSOLIDATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId":"USER_ID"}'
```

## Follow-ups (not implemented)

- `ontology_proposal` generation from clustering
- Declarative fact merging
- Stale community summary refresh when `community.updatedAt > summary.generatedAt`
