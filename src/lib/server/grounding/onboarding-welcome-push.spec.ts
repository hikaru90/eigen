import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GROUNDING_CHECK_IN_TAG } from '$lib/server/grounding/constants'
import {
  getOnboardingFirstGroundingQuestion,
  processOnboardingGroundingPushJob,
  scheduleOnboardingGroundingPush,
} from '$lib/server/grounding/onboarding-welcome-push'

const {
  listPushSubscriptionsForUserMock,
  sendPushToUserMock,
  enqueueUserJobMock,
  createAdminSqlMock,
  sqlEndMock,
  sqlQueryMock,
  loadGroundingProfileRowMock,
  canSendGroundingPushTodayMock,
  recordGroundingPushSentMock,
} = vi.hoisted(() => ({
  listPushSubscriptionsForUserMock: vi.fn(),
  sendPushToUserMock: vi.fn(),
  enqueueUserJobMock: vi.fn(),
  createAdminSqlMock: vi.fn(),
  sqlEndMock: vi.fn(),
  sqlQueryMock: vi.fn(),
  loadGroundingProfileRowMock: vi.fn(),
  canSendGroundingPushTodayMock: vi.fn(),
  recordGroundingPushSentMock: vi.fn(),
}))

vi.mock('$lib/server/push/subscription', () => ({
  listPushSubscriptionsForUser: listPushSubscriptionsForUserMock,
}))

vi.mock('$lib/server/push/send', () => ({
  sendPushToUser: sendPushToUserMock,
}))

vi.mock('$lib/server/job-queue/enqueue', () => ({
  enqueueUserJob: enqueueUserJobMock,
}))

vi.mock('$lib/server/job-queue/admin-db', () => ({
  createAdminSql: createAdminSqlMock,
}))

vi.mock('$lib/server/grounding/profile', () => ({
  loadGroundingProfileRow: loadGroundingProfileRowMock,
}))

vi.mock('$lib/server/grounding/push-throttle', () => ({
  canSendGroundingPushToday: canSendGroundingPushTodayMock,
  recordGroundingPushSent: recordGroundingPushSentMock,
}))

describe('onboarding welcome push', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPushSubscriptionsForUserMock.mockResolvedValue([{ id: 'sub1' }])
    sendPushToUserMock.mockResolvedValue({ sent: 1, failed: 0, removed: 0, errors: [] })
    enqueueUserJobMock.mockResolvedValue({ enqueued: true, jobId: 'job-1' })
    sqlQueryMock.mockResolvedValue([])
    sqlEndMock.mockResolvedValue(undefined)
    createAdminSqlMock.mockReturnValue(Object.assign(sqlQueryMock, { end: sqlEndMock }))
    loadGroundingProfileRowMock.mockResolvedValue(null)
    canSendGroundingPushTodayMock.mockReturnValue(true)
    recordGroundingPushSentMock.mockResolvedValue(undefined)
  })

  it('builds the fixed first grounding question', () => {
    expect(getOnboardingFirstGroundingQuestion()).toEqual({
      facetKey: 'work',
      question: 'Where do you work?',
    })
  })

  it('sends the welcome push with shared tag and check-in deep link', async () => {
    await processOnboardingGroundingPushJob('u1')
    expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
      title: 'One quick question',
      body: 'Where do you work?',
      url: '/capture?checkin=1&welcome=1',
      tag: GROUNDING_CHECK_IN_TAG,
    })
  })

  it('persists pending check-in after a successful welcome push', async () => {
    await processOnboardingGroundingPushJob('u1')
    expect(recordGroundingPushSentMock).toHaveBeenCalledWith('u1', {
      kind: 'grounding',
      facetKey: 'work',
      question: 'Where do you work?',
    })
  })

  it('skips sending when a grounding push was already sent within 24h (shared cap)', async () => {
    canSendGroundingPushTodayMock.mockReturnValue(false)
    loadGroundingProfileRowMock.mockResolvedValue({
      lastGroundingPushAt: new Date(),
    })

    await processOnboardingGroundingPushJob('u1')

    expect(sendPushToUserMock).not.toHaveBeenCalled()
    expect(recordGroundingPushSentMock).not.toHaveBeenCalled()
  })

  it('skips sending when a prior onboarding push already completed (idempotent across retries)', async () => {
    sqlQueryMock.mockResolvedValue([{ id: 'done' }])

    await processOnboardingGroundingPushJob('u1')

    expect(sendPushToUserMock).not.toHaveBeenCalled()
  })

  it('refuses to schedule without a push subscription', async () => {
    listPushSubscriptionsForUserMock.mockResolvedValue([])
    const result = await scheduleOnboardingGroundingPush({ userId: 'u1', delayMs: 30_000 })
    expect(result).toEqual({ scheduled: false, reason: 'no_push_subscription' })
    expect(enqueueUserJobMock).not.toHaveBeenCalled()
  })

  it('enqueues a delayed job when subscribed', async () => {
    const result = await scheduleOnboardingGroundingPush({ userId: 'u1', delayMs: 30_000 })
    expect(result).toEqual({ scheduled: true, jobId: 'job-1', delayMs: 30_000 })
    expect(enqueueUserJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        jobType: 'onboarding_grounding_push',
        dedupeKey: 'onboarding_grounding_push',
        maxAttempts: 3,
      }),
    )
  })

  it('skips enqueue when a prior onboarding push job exists', async () => {
    sqlQueryMock.mockResolvedValue([{ id: 'existing' }])
    const result = await scheduleOnboardingGroundingPush({ userId: 'u1', delayMs: 30_000 })
    expect(result).toEqual({ scheduled: false, reason: 'duplicate' })
    expect(enqueueUserJobMock).not.toHaveBeenCalled()
  })
})
