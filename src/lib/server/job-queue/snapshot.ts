import { createAdminSql } from './admin-db'

export type JobQueueSnapshot = {
  pendingDue: number
  pendingFuture: number
  running: number
  failed: number
  oldestDuePendingAgeSec: number | null
}

type CountRow = { count: string }
type AgeRow = { age_sec: string | null }

export async function loadJobQueueSnapshot(): Promise<JobQueueSnapshot> {
  const sql = createAdminSql(1)
  try {
    const [pendingDueRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM user_job_queue q
			INNER JOIN "user" u ON u.id = q.user_id
			WHERE q.status = 'pending'
				AND q.run_after <= now()
				AND u.account_kind = 'production'
		`
    const [pendingFutureRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM user_job_queue q
			INNER JOIN "user" u ON u.id = q.user_id
			WHERE q.status = 'pending'
				AND q.run_after > now()
				AND u.account_kind = 'production'
		`
    const [runningRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM user_job_queue q
			INNER JOIN "user" u ON u.id = q.user_id
			WHERE q.status = 'running'
				AND u.account_kind = 'production'
		`
    const [failedRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM user_job_queue q
			INNER JOIN "user" u ON u.id = q.user_id
			WHERE q.status = 'failed'
				AND u.account_kind = 'production'
		`
    const [oldestRow] = await sql<AgeRow[]>`
			SELECT extract(epoch FROM (now() - min(q.run_after)))::text AS age_sec
			FROM user_job_queue q
			INNER JOIN "user" u ON u.id = q.user_id
			WHERE q.status = 'pending'
				AND q.run_after <= now()
				AND u.account_kind = 'production'
		`

    const oldestRaw = oldestRow?.age_sec
    const oldestDuePendingAgeSec =
      oldestRaw !== null && oldestRaw !== undefined ? Number(oldestRaw) : null

    return {
      pendingDue: Number(pendingDueRow?.count ?? 0),
      pendingFuture: Number(pendingFutureRow?.count ?? 0),
      running: Number(runningRow?.count ?? 0),
      failed: Number(failedRow?.count ?? 0),
      oldestDuePendingAgeSec: Number.isFinite(oldestDuePendingAgeSec)
        ? oldestDuePendingAgeSec
        : null,
    }
  } finally {
    await sql.end()
  }
}
