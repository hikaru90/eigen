/**
 * POST /api/admin/dispatch-reminders
 *
 * Fire due event reminder and daily summary push notifications. Authenticated with X-Admin-Key
 * (same pattern as consolidation). Scheduled via pg_cron → pg_net
 * (see scripts/ensure-reminder-cron.mjs).
 */

import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { env } from '$lib/server/env/private-env'
import { tickNotificationDispatch } from '$lib/server/memory/notification-dispatch-tick'

function getAdminKey(): string | undefined {
  return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined
}

export const POST: RequestHandler = async (event) => {
  const adminKey = event.request.headers.get('x-admin-key')?.trim()
  const configuredAdminKey = getAdminKey()

  if (!configuredAdminKey || adminKey !== configuredAdminKey) {
    error(401, 'Unauthorized')
  }

  const startedAt = Date.now()
  const result = await tickNotificationDispatch()
  if (!result) {
    return json({ ok: true, skipped: true, reason: 'tick_already_running' })
  }

  console.info('[dispatch-reminders] completed', {
    durationMs: Date.now() - startedAt,
    eventReminders: result.eventReminders,
    dailySummaries: result.dailySummaries,
  })

  return json({ ok: true, ...result })
}
