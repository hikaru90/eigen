import { ensureOvernightJobsEnqueued } from './ensure-overnight'
import { drainUserJobQueue } from './drain'
import { loadJobQueueSnapshot } from './snapshot'

export type TickGlobalJobQueueResult = {
  enqueued: number
  drain: Awaited<ReturnType<typeof drainUserJobQueue>>
}

let ticking = false
let tickCount = 0

/** Log queue depth every N ticks even when idle (default 15 min at 60s interval). */
const HEARTBEAT_EVERY_TICKS = 15

/** Global queue tick: enqueue due overnight jobs, then drain pending work for all users. */
export async function tickGlobalJobQueue(): Promise<TickGlobalJobQueueResult> {
  if (ticking) {
    console.warn('[job-queue] tick skipped — previous tick still running')
    return { enqueued: 0, drain: { claimed: 0, completed: 0, failed: 0 } }
  }

  ticking = true
  try {
    tickCount += 1
    const enqueued = await ensureOvernightJobsEnqueued()
    const drain = await drainUserJobQueue()
    const hasActivity = enqueued > 0 || drain.claimed > 0
    const shouldHeartbeat = tickCount % HEARTBEAT_EVERY_TICKS === 0
    const shouldInspectBacklog = hasActivity || shouldHeartbeat || drain.claimed === 0

    if (shouldInspectBacklog) {
      const snapshot = await loadJobQueueSnapshot()
      if (hasActivity) {
        console.info('[job-queue] tick', { enqueued, ...drain, queue: snapshot })
      } else if (shouldHeartbeat) {
        console.info('[job-queue] heartbeat', { tickCount, queue: snapshot })
      }

      if (snapshot.pendingDue > 0 && drain.claimed === 0) {
        console.warn('[job-queue] due jobs waiting but none claimed', {
          pendingDue: snapshot.pendingDue,
          oldestDuePendingAgeSec: snapshot.oldestDuePendingAgeSec,
          running: snapshot.running,
        })
      }
    }

    return { enqueued, drain }
  } finally {
    ticking = false
  }
}
