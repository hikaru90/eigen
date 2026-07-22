import { createAdminSql } from '$lib/server/job-queue/admin-db'
import { enqueueUserJob } from '$lib/server/job-queue/enqueue'
import { ONBOARDING_GROUNDING_PUSH_JOB } from '$lib/server/job-queue/constants'
import { GROUNDING_CHECK_IN_TAG } from '$lib/server/grounding/constants'
import { loadGroundingProfileRow } from '$lib/server/grounding/profile'
import {
  canSendGroundingPushToday,
  recordGroundingPushSent,
} from '$lib/server/grounding/push-throttle'
import { buildGroundingQuestionFromTemplate } from '$lib/server/grounding/question-templates'
import { listPushSubscriptionsForUser } from '$lib/server/push/subscription'
import { sendPushToUser } from '$lib/server/push/send'
import type { GroundingQuestion } from '$lib/server/grounding/next-question'
import {
  ONBOARDING_FIRST_TEMPLATE_ID,
  ONBOARDING_GROUNDING_PUSH_DELAY_MS,
  ONBOARDING_WELCOME_CAPTURE_URL,
  ONBOARDING_WELCOME_PUSH_TITLE,
} from '$lib/grounding/onboarding-welcome-constants'

export {
  ONBOARDING_FIRST_TEMPLATE_ID,
  ONBOARDING_GROUNDING_PUSH_DELAY_MS,
  ONBOARDING_WELCOME_CAPTURE_URL,
  ONBOARDING_WELCOME_PUSH_TITLE,
}

export const ONBOARDING_GROUNDING_PUSH_DEDUPE_KEY = 'onboarding_grounding_push'

const MAX_SCHEDULE_DELAY_MS = 120_000

function truncateBody(text: string, max = 140): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

function armDelayedDrain(userId: string, delayMs: number): void {
  const timer = setTimeout(() => {
    void import('$lib/server/job-queue/drain')
      .then(({ drainUserJobQueue }) =>
        drainUserJobQueue({ userId, limit: 5, productionOnly: false }),
      )
      .catch((err) => {
        console.error('[onboarding-welcome-push] delayed drain failed', {
          userId,
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }, delayMs)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

/** Fixed first grounding question for new installs (no LLM — no captures yet). */
export function getOnboardingFirstGroundingQuestion(): GroundingQuestion {
  const built = buildGroundingQuestionFromTemplate({
    templateId: ONBOARDING_FIRST_TEMPLATE_ID,
  })
  if (!built) {
    throw new Error('Onboarding first grounding template failed to build')
  }
  return built
}

export async function hasOnboardingGroundingPushJob(userId: string): Promise<boolean> {
  const sql = createAdminSql(1)
  try {
    const rows = await sql<{ id: string }[]>`
			SELECT id
			FROM user_job_queue
			WHERE user_id = ${userId}
				AND job_type = ${ONBOARDING_GROUNDING_PUSH_JOB}
				AND status IN ('pending', 'running', 'completed')
			LIMIT 1
		`
    return rows.length > 0
  } finally {
    await sql.end()
  }
}

export async function hasCompletedOnboardingGroundingPush(userId: string): Promise<boolean> {
  const sql = createAdminSql(1)
  try {
    const rows = await sql<{ id: string }[]>`
			SELECT id
			FROM user_job_queue
			WHERE user_id = ${userId}
				AND job_type = ${ONBOARDING_GROUNDING_PUSH_JOB}
				AND status = 'completed'
			LIMIT 1
		`
    return rows.length > 0
  } finally {
    await sql.end()
  }
}

/**
 * After the onboarding welcome push fires, surface the same question on Capture
 * when the user opens the deep link — until they answer or dismiss a check-in.
 * Prefer the persisted pending_check_in (set on send); this fallback covers
 * older installs that completed the push before pending persistence existed.
 */
export async function getOnboardingWelcomeQuestionIfAvailable(
  userId: string,
): Promise<(GroundingQuestion & { kind: 'grounding' }) | null> {
  const completed = await hasCompletedOnboardingGroundingPush(userId)
  if (!completed) return null

  const profile = await loadGroundingProfileRow(userId)
  if (profile?.lastSessionAt) return null
  const work = profile?.facets?.work?.trim() ?? ''
  if (work.length > 0) return null

  const question = getOnboardingFirstGroundingQuestion()
  return { kind: 'grounding', ...question }
}

export type ScheduleOnboardingGroundingPushResult =
  | { scheduled: true; jobId: string; delayMs: number }
  | { scheduled: false; reason: 'duplicate' | 'no_push_subscription' }

/**
 * Schedule the first grounding push ~30s after PWA install (caller supplies remaining delay).
 * Also arms an in-process timer so we do not wait solely on the 60s job-queue ticker.
 */
export async function scheduleOnboardingGroundingPush(input: {
  userId: string
  delayMs?: number
}): Promise<ScheduleOnboardingGroundingPushResult> {
  const subs = await listPushSubscriptionsForUser(input.userId)
  if (subs.length === 0) {
    return { scheduled: false, reason: 'no_push_subscription' }
  }

  if (await hasOnboardingGroundingPushJob(input.userId)) {
    return { scheduled: false, reason: 'duplicate' }
  }

  const rawDelay =
    typeof input.delayMs === 'number' && Number.isFinite(input.delayMs)
      ? input.delayMs
      : ONBOARDING_GROUNDING_PUSH_DELAY_MS
  const delayMs = Math.max(0, Math.min(MAX_SCHEDULE_DELAY_MS, Math.floor(rawDelay)))

  const enqueued = await enqueueUserJob({
    userId: input.userId,
    jobType: ONBOARDING_GROUNDING_PUSH_JOB,
    runAfter: new Date(Date.now() + delayMs),
    dedupeKey: ONBOARDING_GROUNDING_PUSH_DEDUPE_KEY,
    payload: { source: 'onboarding_pwa_install' },
    maxAttempts: 3,
  })

  if (!enqueued.enqueued) {
    return { scheduled: false, reason: 'duplicate' }
  }

  armDelayedDrain(input.userId, delayMs)

  return { scheduled: true, jobId: enqueued.jobId, delayMs }
}

export async function processOnboardingGroundingPushJob(userId: string): Promise<void> {
  // Guard against job retries / re-dispatch re-sending the welcome push. Once a
  // prior run completed, the job is marked done in the queue; a later retry of
  // this handler must not send again. Does not swallow send errors — if the
  // (first) send fails, no completed row exists and the job may retry normally.
  if (await hasCompletedOnboardingGroundingPush(userId)) {
    return
  }

  const profile = await loadGroundingProfileRow(userId)
  if (!canSendGroundingPushToday(profile)) {
    return
  }

  const question = getOnboardingFirstGroundingQuestion()
  await sendPushToUser(userId, {
    title: ONBOARDING_WELCOME_PUSH_TITLE,
    body: truncateBody(question.question),
    url: ONBOARDING_WELCOME_CAPTURE_URL,
    tag: GROUNDING_CHECK_IN_TAG,
  })

  await recordGroundingPushSent(userId, { kind: 'grounding', ...question })
}
