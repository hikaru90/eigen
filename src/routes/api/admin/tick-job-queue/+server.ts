/**
 * POST /api/admin/tick-job-queue
 *
 * Enqueue due overnight jobs and drain the per-user job queue.
 * Scheduled via pg_cron → pg_net as a production backup to the in-process ticker
 * (see scripts/ensure-job-queue-cron.mjs).
 */

import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { tickGlobalJobQueue } from '$lib/server/job-queue/tick'

function getAdminKey(): string | undefined {
  return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined
}

export const POST: RequestHandler = async (event) => {
  const adminKey = event.request.headers.get('x-admin-key')?.trim()
  const configuredAdminKey = getAdminKey()

  if (!configuredAdminKey || adminKey !== configuredAdminKey) {
    error(401, 'Unauthorized')
  }

  const result = await tickGlobalJobQueue()
  console.info('[admin/tick-job-queue] completed', result)
  return json({ ok: true, ...result })
}
