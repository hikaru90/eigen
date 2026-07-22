/**
 * Schedule nightly consolidation via pg_cron + pg_net (HTTP POST to app).
 *
 * Requires DATABASE_ADMIN_URL, ADMIN_CONSOLIDATION_KEY, and a running Postgres
 * with pg_cron + pg_net extensions (see Dockerfile.postgres).
 *
 * Usage: node scripts/ensure-sleep-cron.mjs
 */
import './load-env.mjs'
import postgres from 'postgres'
import { schedulePgCronHttpJob } from './pg-cron-schedule.mjs'

const JOB_NAME = 'eigen-sleep-consolidation'

function getAdminDatabaseUrl() {
  const raw = process.env.DATABASE_ADMIN_URL?.trim()
  if (!raw) {
    throw new Error('DATABASE_ADMIN_URL is required for ensure-sleep-cron.mjs')
  }
  return raw
}

function requireAdminKey() {
  const key = process.env.ADMIN_CONSOLIDATION_KEY?.trim()
  if (!key) {
    throw new Error('ADMIN_CONSOLIDATION_KEY is required to schedule sleep consolidation')
  }
  return key
}

function getInternalUrl() {
  const raw = process.env.CONSOLIDATION_INTERNAL_URL?.trim()
  if (!raw) {
    throw new Error('CONSOLIDATION_INTERNAL_URL is required (e.g. http://app:3000)')
  }
  return raw.replace(/\/$/, '')
}

function getSchedule() {
  return process.env.CONSOLIDATION_CRON_SCHEDULE?.trim() || '0 2 * * *'
}

function getTimezone() {
  return process.env.CONSOLIDATION_CRON_TZ?.trim() || 'UTC'
}

const databaseUrl = getAdminDatabaseUrl()
const sql = postgres(databaseUrl, { max: 1 })

try {
  const adminKey = requireAdminKey()
  const internalUrl = getInternalUrl()
  const schedule = getSchedule()
  const timezone = getTimezone()
  const consolidateUrl = `${internalUrl}/api/admin/consolidate`

  await schedulePgCronHttpJob(sql, {
    jobName: JOB_NAME,
    schedule,
    timezone,
    url: consolidateUrl,
    adminKey,
    databaseUrl,
  })

  console.log(
    `[eigen] Scheduled "${JOB_NAME}" at "${schedule}" (${timezone}) → POST ${consolidateUrl}`,
  )
} finally {
  await sql.end()
}
