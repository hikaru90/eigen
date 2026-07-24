import { createAdminSql } from './admin-db'

/**
 * Jobs stuck in `running` longer than this are requeued. Long enough that a
 * legitimate single-tick dispatch (webhook HTTP, onboarding push) completes well
 * inside it, short enough that HMR-reload orphans don't accumulate.
 */
export const STALE_RUNNING_JOB_MAX_AGE_MS = 5 * 60 * 1000

const STALE_RUNNING_RECOVERY_NOTE =
  'Job requeued after stale running recovery (worker crash or module reload)'

/**
 * Requeue `user_job_queue` rows left in `running` longer than the threshold.
 * Returns the number requeued.
 *
 * Mirrors `recoverStaleEnrichProcessingRows` for the job queue. An HMR module
 * reload (or worker crash) can kill an in-flight tick mid-dispatch, orphaning
 * its claimed batch as `running` forever — `claimDueJobs` only ever claims
 * `status = 'pending'`, so without this recovery those rows pile up across
 * dev-server restarts/reloads and eventually drown the snapshot. Scoped to
 * production tenants to match the ticker's drain scope so recovered rows are
 * immediately drainable.
 */
export async function recoverStaleRunningJobs(
  maxAgeMs: number = STALE_RUNNING_JOB_MAX_AGE_MS,
): Promise<number> {
  const sql = createAdminSql(1)
  try {
    const cutoff = new Date(Date.now() - maxAgeMs)
    const requeued = await sql<{ id: string }[]>`
      UPDATE user_job_queue
      SET status = 'pending',
          run_after = now(),
          started_at = null,
          last_error = ${STALE_RUNNING_RECOVERY_NOTE},
          updated_at = now()
      WHERE status = 'running'
        AND started_at IS NOT NULL
        AND started_at < ${cutoff}
        AND user_id IN (SELECT id FROM "user" WHERE account_kind = 'production')
      RETURNING id
    `
    return requeued.length
  } finally {
    await sql.end()
  }
}
