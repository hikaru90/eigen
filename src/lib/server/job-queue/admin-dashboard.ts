import { withDbUser } from '$lib/server/db'
import { createAdminSql } from './admin-db'
import { loadJobQueueSnapshot, type JobQueueSnapshot } from './snapshot'
import { loadOpsHealthSnapshot, type OpsHealthSnapshot } from '$lib/server/ops/health-snapshot'
import {
  buildDailySummaryPreviewForUser,
  dailySummaryDispatchReasonLabel,
  evaluateDailySummaryDispatch,
  type DailySummaryDispatchEvaluation,
  type DailySummaryPreview,
} from '$lib/server/memory/daily-summary-visibility'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

export type AdminQueueJobRow = {
  id: string
  userId: string
  userEmail: string | null
  accountKind: string
  jobType: string
  status: string
  runAfter: string
  attemptCount: number
  maxAttempts: number
  lastError: string | null
  dedupeKey: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type AdminDailySummaryRow = {
  userId: string
  userEmail: string | null
  accountKind: string
  timeZone: string
  scheduledTimeLocal: string
  lastSentLocalDate: string | null
  pushDeviceCount: number
  dispatch: DailySummaryDispatchEvaluation
  preview: DailySummaryPreview
  statusLabel: string
}

export type AdminQueueDashboard = {
  at: string
  summary: JobQueueSnapshot
  ops: OpsHealthSnapshot
  dailySummaries: AdminDailySummaryRow[]
  jobs: AdminQueueJobRow[]
}

type RawJobRow = {
  id: string
  user_id: string
  user_email: string | null
  account_kind: string
  job_type: string
  status: string
  run_after: Date
  attempt_count: number
  max_attempts: number
  last_error: string | null
  dedupe_key: string | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

export type AdminQueueListOptions = {
  limit?: number
  status?: 'all' | 'pending' | 'running' | 'failed' | 'completed' | 'cancelled'
  includeHarness?: boolean
}

function mapJobRow(row: RawJobRow): AdminQueueJobRow {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    accountKind: row.account_kind,
    jobType: row.job_type,
    status: row.status,
    runAfter: row.run_after.toISOString(),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  }
}

async function listQueueJobs(options: AdminQueueListOptions): Promise<AdminQueueJobRow[]> {
  const limit = options.limit ?? 100
  const sql = createAdminSql(1)
  try {
    const rows =
      options.status && options.status !== 'all'
        ? options.includeHarness
          ? await sql<RawJobRow[]>`
					SELECT
						q.id,
						q.user_id,
						u.email AS user_email,
						u.account_kind,
						q.job_type,
						q.status,
						q.run_after,
						q.attempt_count,
						q.max_attempts,
						q.last_error,
						q.dedupe_key,
						q.created_at,
						q.started_at,
						q.finished_at
					FROM user_job_queue q
					INNER JOIN "user" u ON u.id = q.user_id
					WHERE q.status = ${options.status}
					ORDER BY q.run_after DESC, q.created_at DESC
					LIMIT ${limit}
				`
          : await sql<RawJobRow[]>`
					SELECT
						q.id,
						q.user_id,
						u.email AS user_email,
						u.account_kind,
						q.job_type,
						q.status,
						q.run_after,
						q.attempt_count,
						q.max_attempts,
						q.last_error,
						q.dedupe_key,
						q.created_at,
						q.started_at,
						q.finished_at
					FROM user_job_queue q
					INNER JOIN "user" u ON u.id = q.user_id
					WHERE q.status = ${options.status}
						AND u.account_kind = 'production'
					ORDER BY q.run_after DESC, q.created_at DESC
					LIMIT ${limit}
				`
        : options.includeHarness
          ? await sql<RawJobRow[]>`
					SELECT
						q.id,
						q.user_id,
						u.email AS user_email,
						u.account_kind,
						q.job_type,
						q.status,
						q.run_after,
						q.attempt_count,
						q.max_attempts,
						q.last_error,
						q.dedupe_key,
						q.created_at,
						q.started_at,
						q.finished_at
					FROM user_job_queue q
					INNER JOIN "user" u ON u.id = q.user_id
					ORDER BY
						CASE
							WHEN q.status = 'pending' AND q.run_after <= now() THEN 0
							WHEN q.status = 'running' THEN 1
							WHEN q.status = 'pending' THEN 2
							WHEN q.status = 'failed' THEN 3
							ELSE 4
						END,
						q.run_after ASC,
						q.created_at DESC
					LIMIT ${limit}
				`
          : await sql<RawJobRow[]>`
					SELECT
						q.id,
						q.user_id,
						u.email AS user_email,
						u.account_kind,
						q.job_type,
						q.status,
						q.run_after,
						q.attempt_count,
						q.max_attempts,
						q.last_error,
						q.dedupe_key,
						q.created_at,
						q.started_at,
						q.finished_at
					FROM user_job_queue q
					INNER JOIN "user" u ON u.id = q.user_id
					WHERE u.account_kind = 'production'
					ORDER BY
						CASE
							WHEN q.status = 'pending' AND q.run_after <= now() THEN 0
							WHEN q.status = 'running' THEN 1
							WHEN q.status = 'pending' THEN 2
							WHEN q.status = 'failed' THEN 3
							ELSE 4
						END,
						q.run_after ASC,
						q.created_at DESC
					LIMIT ${limit}
				`

    return rows.map(mapJobRow)
  } finally {
    await sql.end()
  }
}

type RawDailySummaryRow = {
  user_id: string
  user_email: string | null
  account_kind: string
  daily_summary_minutes_local: number
  last_daily_summary_local_date: string | null
  last_daily_summary_dispatch_error: string | null
  push_count: string
}

async function listDailySummaryRows(includeHarness: boolean): Promise<AdminDailySummaryRow[]> {
  const sql = createAdminSql(1)
  const now = new Date()
  try {
    const rows = includeHarness
      ? await sql<RawDailySummaryRow[]>`
				SELECT
					u.id AS user_id,
					u.email AS user_email,
					u.account_kind,
					up.daily_summary_minutes_local,
					up.last_daily_summary_local_date,
					up.last_daily_summary_dispatch_error,
					(SELECT count(*)::text FROM push_subscription ps WHERE ps.user_id = u.id) AS push_count
				FROM user_preference up
				INNER JOIN "user" u ON u.id = up.user_id
				WHERE up.daily_summary_enabled = true
				ORDER BY u.email NULLS LAST, u.id
			`
      : await sql<RawDailySummaryRow[]>`
				SELECT
					u.id AS user_id,
					u.email AS user_email,
					u.account_kind,
					up.daily_summary_minutes_local,
					up.last_daily_summary_local_date,
					up.last_daily_summary_dispatch_error,
					(SELECT count(*)::text FROM push_subscription ps WHERE ps.user_id = u.id) AS push_count
				FROM user_preference up
				INNER JOIN "user" u ON u.id = up.user_id
				WHERE up.daily_summary_enabled = true
					AND u.account_kind = 'production'
				ORDER BY u.email NULLS LAST, u.id
			`

    const result: AdminDailySummaryRow[] = []
    for (const row of rows) {
      await withDbUser(row.user_id, async () => {
        const timeZone = await getUserPreferredTimezone(row.user_id)
        const pushDeviceCount = Number(row.push_count)
        const dispatch = evaluateDailySummaryDispatch({
          now,
          timeZone,
          dailySummaryMinutesLocal: row.daily_summary_minutes_local,
          lastDailySummaryLocalDate: row.last_daily_summary_local_date,
          lastDailySummaryDispatchError: row.last_daily_summary_dispatch_error,
          pushDeviceCount,
        })
        const preview = await buildDailySummaryPreviewForUser(row.user_id, now)
        result.push({
          userId: row.user_id,
          userEmail: row.user_email,
          accountKind: row.account_kind,
          timeZone,
          scheduledTimeLocal: dispatch.scheduledTimeLocal,
          lastSentLocalDate: row.last_daily_summary_local_date,
          pushDeviceCount,
          dispatch,
          preview,
          statusLabel: dailySummaryDispatchReasonLabel(dispatch.reason, dispatch.lastDispatchError),
        })
      })
    }
    return result
  } finally {
    await sql.end()
  }
}

export async function loadAdminQueueDashboard(
  options: AdminQueueListOptions = {},
): Promise<AdminQueueDashboard> {
  const includeHarness = options.includeHarness ?? false
  const [summary, ops, dailySummaries, jobs] = await Promise.all([
    loadJobQueueSnapshot(),
    loadOpsHealthSnapshot(),
    listDailySummaryRows(includeHarness),
    listQueueJobs(options),
  ])

  return {
    at: new Date().toISOString(),
    summary,
    ops,
    dailySummaries,
    jobs,
  }
}
