/**
 * Schedule per-minute job queue drain via pg_cron + pg_net (HTTP POST to app).
 *
 * Requires DATABASE_ADMIN_URL, ADMIN_CONSOLIDATION_KEY, and a running Postgres
 * with pg_cron + pg_net extensions (see Dockerfile.postgres).
 *
 * Usage: node scripts/ensure-job-queue-cron.mjs
 */
import './load-env.mjs'
import postgres from 'postgres'
import { schedulePgCronHttpJob } from './pg-cron-schedule.mjs'

const JOB_NAME = 'eigen-job-queue-tick'

function getAdminDatabaseUrl() {
  const raw = process.env.DATABASE_ADMIN_URL?.trim()
  if (!raw) {
    throw new Error('DATABASE_ADMIN_URL is required for ensure-job-queue-cron.mjs')
  }
  return raw
}

function requireAdminKey() {
  const key = process.env.ADMIN_CONSOLIDATION_KEY?.trim()
  if (!key) {
    throw new Error('ADMIN_CONSOLIDATION_KEY is required to schedule job queue ticks')
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
  return process.env.JOB_QUEUE_CRON_SCHEDULE?.trim() || '* * * * *'
}

function getTimezone() {
  return process.env.JOB_QUEUE_CRON_TZ?.trim() || process.env.REMINDER_CRON_TZ?.trim() || 'UTC'
}

const databaseUrl = getAdminDatabaseUrl()
const sql = postgres(databaseUrl, { max: 1 })

try {
  const adminKey = requireAdminKey()
  const internalUrl = getInternalUrl()
  const schedule = getSchedule()
  const timezone = getTimezone()
  const tickUrl = `${internalUrl}/api/admin/tick-job-queue`

  await schedulePgCronHttpJob(sql, {
    jobName: JOB_NAME,
    schedule,
    timezone,
    url: tickUrl,
    adminKey,
    databaseUrl,
  })

  console.log(`[eigen] Scheduled "${JOB_NAME}" at "${schedule}" (${timezone}) → POST ${tickUrl}`)
} finally {
  await sql.end()
}
