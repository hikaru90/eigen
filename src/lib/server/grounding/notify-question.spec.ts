import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GROUNDING_CHECK_IN_TAG } from '$lib/server/grounding/constants'
import { maybeNotifyGroundingQuestionPush } from '$lib/server/grounding/notify-question'

const {
  isCheckInQuestionDueMock,
  listPushSubscriptionsForUserMock,
  generateCheckInQuestionMock,
  sendPushToUserMock,
  loadGroundingProfileRowMock,
  canSendGroundingPushTodayMock,
  recordGroundingPushSentMock,
  queueEmailMock,
} = vi.hoisted(() => ({
  isCheckInQuestionDueMock: vi.fn(),
  listPushSubscriptionsForUserMock: vi.fn(),
  generateCheckInQuestionMock: vi.fn(),
  sendPushToUserMock: vi.fn(),
  loadGroundingProfileRowMock: vi.fn(),
  canSendGroundingPushTodayMock: vi.fn(),
  recordGroundingPushSentMock: vi.fn(),
  queueEmailMock: vi.fn(),
}))

vi.mock('$lib/server/grounding/question-due', () => ({
  isCheckInQuestionDue: isCheckInQuestionDueMock,
}))

vi.mock('$lib/server/push/subscription', () => ({
  listPushSubscriptionsForUser: listPushSubscriptionsForUserMock,
}))

vi.mock('$lib/server/grounding/next-check-in', () => ({
  generateCheckInQuestion: generateCheckInQuestionMock,
}))

vi.mock('$lib/server/push/send', () => ({
  sendPushToUser: sendPushToUserMock,
}))

vi.mock('$lib/server/notify/notification-email', () => ({
  queueNotificationEmail: queueEmailMock,
}))

vi.mock('$lib/server/grounding/profile', () => ({
  loadGroundingProfileRow: loadGroundingProfileRowMock,
}))

vi.mock('$lib/server/grounding/push-throttle', () => ({
  canSendGroundingPushToday: canSendGroundingPushTodayMock,
  recordGroundingPushSent: recordGroundingPushSentMock,
}))

const SAMPLE_QUESTION = {
  kind: 'grounding' as const,
  facetKey: 'work' as const,
  question: 'What kind of work do you do?',
}

describe('maybeNotifyGroundingQuestionPush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCheckInQuestionDueMock.mockResolvedValue(true)
    listPushSubscriptionsForUserMock.mockResolvedValue([{ id: 'sub1' }])
    generateCheckInQuestionMock.mockResolvedValue(SAMPLE_QUESTION)
    sendPushToUserMock.mockResolvedValue({ sent: 1, failed: 0, removed: 0, errors: [] })
    queueEmailMock.mockResolvedValue(undefined)
    loadGroundingProfileRowMock.mockResolvedValue(null)
    canSendGroundingPushTodayMock.mockReturnValue(true)
    recordGroundingPushSentMock.mockResolvedValue(undefined)
  })

  it('skips off-interval capture counts', async () => {
    await maybeNotifyGroundingQuestionPush('u1', 11)
    expect(isCheckInQuestionDueMock).not.toHaveBeenCalled()
  })

  it('sends grounding push with shared tag and check-in link when due and subscribed', async () => {
    await maybeNotifyGroundingQuestionPush('u1', 10)

    expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
      title: 'Improve capture quality',
      body: 'What kind of work do you do?',
      url: '/capture?checkin=1',
      tag: GROUNDING_CHECK_IN_TAG,
    })
    expect(queueEmailMock).toHaveBeenCalledWith('u1', {
      title: 'Improve capture quality',
      body: 'What kind of work do you do?',
      url: '/capture?checkin=1',
      tag: GROUNDING_CHECK_IN_TAG,
    })
  })

  it('persists pending check-in after a successful push (does not bump last_session_at)', async () => {
    await maybeNotifyGroundingQuestionPush('u1', 10)

    expect(recordGroundingPushSentMock).toHaveBeenCalledTimes(1)
    expect(recordGroundingPushSentMock).toHaveBeenCalledWith('u1', SAMPLE_QUESTION)
  })

  it('does not record the push before send succeeds', async () => {
    let sendResolved = false
    sendPushToUserMock.mockImplementation(async () => {
      sendResolved = true
      return { sent: 1, failed: 0, removed: 0, errors: [] }
    })
    recordGroundingPushSentMock.mockImplementation(async () => {
      expect(sendResolved).toBe(true)
    })

    await maybeNotifyGroundingQuestionPush('u1', 10)

    expect(recordGroundingPushSentMock).toHaveBeenCalledTimes(1)
  })

  it('uses memory-check title for relevance questions', async () => {
    const relevance = {
      kind: 'relevance' as const,
      templateId: 'thought_still_relevant' as const,
      thoughtId: 't1',
      snippet: 'Old note',
      question: 'Still relevant for you?',
    }
    generateCheckInQuestionMock.mockResolvedValue(relevance)

    await maybeNotifyGroundingQuestionPush('u1', 20)

    expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
      title: 'Quick memory check',
      body: 'Still relevant for you?',
      url: '/capture?checkin=1',
      tag: GROUNDING_CHECK_IN_TAG,
    })
    expect(recordGroundingPushSentMock).toHaveBeenCalledWith('u1', relevance)
  })

  it('skips when not due', async () => {
    isCheckInQuestionDueMock.mockResolvedValue(false)
    await maybeNotifyGroundingQuestionPush('u1', 10)
    expect(sendPushToUserMock).not.toHaveBeenCalled()
    expect(recordGroundingPushSentMock).not.toHaveBeenCalled()
  })

  it('skips when a grounding push was already sent within 24h', async () => {
    canSendGroundingPushTodayMock.mockReturnValue(false)
    loadGroundingProfileRowMock.mockResolvedValue({
      lastGroundingPushAt: new Date(),
    })

    await maybeNotifyGroundingQuestionPush('u1', 10)

    expect(sendPushToUserMock).not.toHaveBeenCalled()
    expect(recordGroundingPushSentMock).not.toHaveBeenCalled()
  })

  it('skips when user has no push subscription', async () => {
    listPushSubscriptionsForUserMock.mockResolvedValue([])
    await maybeNotifyGroundingQuestionPush('u1', 10)
    expect(sendPushToUserMock).not.toHaveBeenCalled()
    expect(recordGroundingPushSentMock).not.toHaveBeenCalled()
  })

  it('does not record when push delivery fails', async () => {
    sendPushToUserMock.mockRejectedValue(new Error('Push delivery failed: all endpoints failed'))

    await maybeNotifyGroundingQuestionPush('u1', 10)

    expect(sendPushToUserMock).toHaveBeenCalledTimes(1)
    expect(recordGroundingPushSentMock).not.toHaveBeenCalled()
    expect(queueEmailMock).not.toHaveBeenCalled()
  })

  it('does not re-send when called again at the same milestone after the due gate blocks', async () => {
    await maybeNotifyGroundingQuestionPush('u1', 10)
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1)
    expect(recordGroundingPushSentMock).toHaveBeenCalledTimes(1)

    isCheckInQuestionDueMock.mockResolvedValue(false)

    await maybeNotifyGroundingQuestionPush('u1', 10)
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1)
    expect(recordGroundingPushSentMock).toHaveBeenCalledTimes(1)
  })
})
