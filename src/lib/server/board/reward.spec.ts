import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rewardShippedIdea } from './reward'

const m = vi.hoisted(() => ({
  ideaRows: [] as Array<{ authorUserId: string | null; title: string; kind?: string; area?: string; note?: string | null }>,
  judge: vi.fn(),
  grant: vi.fn(),
  notify: vi.fn(),
  email: vi.fn(),
  subs: vi.fn(),
  push: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => m.ideaRows }) }) }),
  }),
}))
vi.mock('$lib/server/billing/wallet', () => ({
  IDEA_SHIPPED_REWARD_CREDITS: 5,
  grantIdeaShippedReward: m.grant,
}))
vi.mock('$lib/server/notifications/service', () => ({ createNotification: m.notify }))
vi.mock('$lib/server/notify/notification-email', () => ({ queueNotificationEmail: m.email }))
vi.mock('$lib/server/push/subscription', () => ({ listPushSubscriptionsForUser: m.subs }))
vi.mock('$lib/server/push/send', () => ({ sendPushToUser: m.push }))
vi.mock('./reward-judge', () => ({ judgeIdeaReward: m.judge }))

describe('rewardShippedIdea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.ideaRows = [{ authorUserId: 'author-1', title: 'Voice input on Contribute' }]
    m.grant.mockResolvedValue({ granted: true })
    m.judge.mockResolvedValue({ reward: true, reason: 'Real request' })
    m.email.mockResolvedValue(undefined)
    m.subs.mockResolvedValue([{ id: 's1' }])
    m.push.mockResolvedValue({ sent: 1 })
  })

  it('pays the author 5 credits and notifies them in the app, by push and by email', async () => {
    const out = await rewardShippedIdea('idea-1', 'maker-1')
    expect(m.grant).toHaveBeenCalledWith({ userId: 'author-1', ideaId: 'idea-1' })
    expect(m.notify).toHaveBeenCalledWith(
      'author-1',
      expect.objectContaining({ kind: 'idea_shipped', href: '/feedback' }),
    )
    expect(m.notify.mock.calls[0][1].body).toContain('Voice input on Contribute')
    expect(m.email).toHaveBeenCalledWith('author-1', expect.objectContaining({ url: '/feedback' }))
    expect(m.push).toHaveBeenCalledWith('author-1', expect.objectContaining({ url: '/feedback' }))
    expect(out).toEqual({
      authorUserId: 'author-1',
      credits: 5,
      judge: { reward: true, reason: 'Real request' },
      push: 'sent',
    })
    expect(m.judge).toHaveBeenCalledWith(expect.objectContaining({ makerUserId: 'maker-1' }))
  })

  it('when the judge declines: no credits, but the author still hears it shipped', async () => {
    m.judge.mockResolvedValue({ reward: false, reason: 'Spam' })
    const out = await rewardShippedIdea('idea-1', 'maker-1')
    expect(m.grant).not.toHaveBeenCalled()
    expect(out).toMatchObject({ credits: 0, judge: { reward: false, reason: 'Spam' } })
    expect(m.notify.mock.calls[0][1].body).not.toContain('credits')
  })

  it('a failed judge fails the reward out loud — nothing is paid or sent', async () => {
    m.judge.mockRejectedValue(new Error('reward check failed 3 times'))
    await expect(rewardShippedIdea('idea-1', 'maker-1')).rejects.toThrow(/3 times/)
    expect(m.grant).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('does nothing more when the idea was already rewarded (re-shipped)', async () => {
    m.grant.mockResolvedValue({ granted: false })
    expect(await rewardShippedIdea('idea-1', 'maker-1')).toBeNull()
    expect(m.notify).not.toHaveBeenCalled()
    expect(m.email).not.toHaveBeenCalled()
    expect(m.push).not.toHaveBeenCalled()
  })

  it('reports no_device when the author has no push subscription', async () => {
    m.subs.mockResolvedValue([])
    expect((await rewardShippedIdea('idea-1', 'maker-1'))?.push).toBe('no_device')
    expect(m.push).not.toHaveBeenCalled()
  })

  it('reports a failed push instead of hiding it; credits, note and email stand', async () => {
    m.push.mockRejectedValue(new Error('vapid'))
    const out = await rewardShippedIdea('idea-1', 'maker-1')
    expect(out?.push).toBe('failed')
    expect(m.notify).toHaveBeenCalled()
    expect(m.email).toHaveBeenCalled()
  })

  it('rewards no one when the author has deleted their account', async () => {
    m.ideaRows = [{ authorUserId: null, title: 'Orphaned idea' }]
    expect(await rewardShippedIdea('idea-1', 'maker-1')).toBeNull()
    expect(m.grant).not.toHaveBeenCalled()
    expect(m.judge).not.toHaveBeenCalled()
  })

  it('throws for an unknown idea', async () => {
    m.ideaRows = []
    await expect(rewardShippedIdea('nope', 'maker-1')).rejects.toThrow(/not found/)
  })
})
