import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants'
import { WEBHOOK_DELIVERY_JOB } from '$lib/server/agents/constants'

export const OVERNIGHT_CONSOLIDATION_JOB = 'overnight_consolidation' as const
export const ONBOARDING_GROUNDING_PUSH_JOB = 'onboarding_grounding_push' as const
export { WEBHOOK_DELIVERY_JOB }
export const OVERNIGHT_CONSOLIDATION_TASK = SLEEP_CONSOLIDATION_TASK_ID

export const DEFAULT_OVERNIGHT_HOUR = 2
export const DEFAULT_OVERNIGHT_MINUTE = 0
export const DEFAULT_OVERNIGHT_TIMEZONE = 'UTC'

/** How often the global in-app ticker scans the queue. */
export const JOB_QUEUE_TICK_MS = 60_000

/** Max jobs processed per ticker pass (across all users). */
export const JOB_QUEUE_BATCH_LIMIT = 10
