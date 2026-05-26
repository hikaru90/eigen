# Apache AGE cutover — rollback playbook

Use this if the AGE runtime cutover causes regressions in capture, retrieval, or `/graph`.

## Preconditions kept for rollback

- `src/lib/server/graph/falkor-legacy.ts` — original FalkorDB client implementation (reference / emergency revert source).
- FalkorDB Docker volume snapshot (if migration ran): `eigen_falkor` volume backup.
- Export artifacts from migration: `tmp/falkor-export-<userId>.json` and `tmp/falkor-to-age-migration-report.json`.

## Fast rollback (runtime)

1. Restore FalkorDB service in `docker-compose.yaml` (see git history before cutover).
2. Restore `.env` / compose env: `FALKOR_HOST`, `FALKOR_PORT`, `FALKOR_USERNAME`, `FALKOR_PASSWORD`.
3. Replace `src/lib/server/graph/falkor.ts` with contents of `falkor-legacy.ts` (or `git checkout` pre-cutover `falkor.ts`).
4. Re-add `falkordb` to `dependencies` in `package.json` and run `npm install`.
5. Redeploy / restart app: `npm run stack:up` or `docker compose up -d --build`.
6. Verify: `npm run test:unit -- src/lib/server/graph/falkor.spec.ts` (restore Falkor-specific tests from git if needed).

## Data rollback

- If Falkor volume was preserved: point app at Falkor again — graph data is intact.
- If Falkor volume was wiped: re-import from `tmp/falkor-export-*.json` using a Falkor restore script (reverse of `scripts/migrate-graph-falkor-to-age.mjs` export format) or re-run capture re-enrich for affected users.

## Verification after rollback

- Capture a thought → graph node exists (`eval` graph checks or `/graph` page).
- Retrieval with graph weight > 0 returns expanded neighbors when relations exist.
- `npm run eval -- --mode qa` on graph-tagged fixtures.

## Forward path (re-attempt AGE)

1. Run `npm run db:migrate-graph-falkor-to-age:dry-run` and review `tmp/falkor-to-age-migration-report.json`.
2. Run `npm run db:migrate-graph-falkor-to-age` with Falkor still reachable.
3. Re-apply AGE `falkor.ts` and remove Falkor from compose.
