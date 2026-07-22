import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  listPushSubscriptionsForUserMock,
  deletePushSubscriptionByIdMock,
  configureWebPushMock,
  sendNotificationMock,
} = vi.hoisted(() => ({
  listPushSubscriptionsForUserMock: vi.fn(),
  deletePushSubscriptionByIdMock: vi.fn(),
  configureWebPushMock: vi.fn(),
  sendNotificationMock: vi.fn(),
}))

vi.mock('./subscription', () => ({
  listPushSubscriptionsForUser: listPushSubscriptionsForUserMock,
  deletePushSubscriptionById: deletePushSubscriptionByIdMock,
}))

vi.mock('./vapid', () => ({
  configureWebPush: configureWebPushMock,
}))

vi.mock('web-push', () => ({
  default: {
    sendNotification: sendNotificationMock,
  },
}))

import { sendPushToUser } from './send'

describe('sendPushToUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when user has no subscriptions', async () => {
    listPushSubscriptionsForUserMock.mockResolvedValue([])
    await expect(sendPushToUser('u1', { title: 't', body: 'b' })).rejects.toThrow(
      /No push subscriptions/,
    )
  })

  it('sends to all subscriptions and reports counts', async () => {
    listPushSubscriptionsForUserMock.mockResolvedValue([
      { id: 's1', endpoint: 'https://a', p256dh: 'p', auth: 'a', userId: 'u1' },
      { id: 's2', endpoint: 'https://b', p256dh: 'p2', auth: 'a2', userId: 'u1' },
    ])
    sendNotificationMock.mockResolvedValue(undefined)

    const result = await sendPushToUser('u1', { title: 'Hi', body: 'There' })
    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
  })

  it('removes gone subscriptions', async () => {
    listPushSubscriptionsForUserMock.mockResolvedValue([
      { id: 'gone', endpoint: 'https://gone', p256dh: 'p', auth: 'a', userId: 'u1' },
      { id: 'ok', endpoint: 'https://ok', p256dh: 'p2', auth: 'a2', userId: 'u1' },
    ])
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 }).mockResolvedValueOnce(undefined)

    const result = await sendPushToUser('u1', { title: 't', body: 'b' })
    expect(result.sent).toBe(1)
    expect(result.removed).toBe(1)
    expect(deletePushSubscriptionByIdMock).toHaveBeenCalledWith('gone')
  })
})
