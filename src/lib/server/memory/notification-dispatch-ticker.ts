import { building } from '$app/environment'
import { tickNotificationDispatch } from '$lib/server/memory/notification-dispatch-tick'

/** Match pg_cron reminder schedule and job-queue ticker cadence. */
export const NOTIFICATION_DISPATCH_TICK_MS = 60_000

let started = false

/**
 * In-process backup for pg_cron → pg_net → POST /api/admin/dispatch-reminders.
 * Without this, push reminders and daily summaries only run when pg_net can reach the app.
 */
export function startNotificationDispatchTicker(): void {
  if (started || building) return
  started = true

  const run = () => {
    void tickNotificationDispatch().catch((err) => {
      console.error('[notification-dispatch] tick failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }

  run()
  const timer = setInterval(run, NOTIFICATION_DISPATCH_TICK_MS)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  console.info('[notification-dispatch] in-process ticker started', {
    intervalMs: NOTIFICATION_DISPATCH_TICK_MS,
  })
}
