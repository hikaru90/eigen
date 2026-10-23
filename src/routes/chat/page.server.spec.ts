import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkCaptureAllowedMock,
  isByokBillingMock,
  getWalletSnapshotMock,
  listChatSessionsMock,
  loadChatSessionMock,
  loadRecentCaptureThoughtsMock,
} = vi.hoisted(() => ({
  checkCaptureAllowedMock: vi.fn(),
  isByokBillingMock: vi.fn(),
  getWalletSnapshotMock: vi.fn(),
  listChatSessionsMock: vi.fn(),
  loadChatSessionMock: vi.fn(),
  loadRecentCaptureThoughtsMock: vi.fn(),
}))

vi.mock('$lib/server/onboarding/capture-gate', () => ({
  checkCaptureAllowed: checkCaptureAllowedMock,
}))
vi.mock('$lib/server/billing/preferences', () => ({
  isByokBilling: isByokBillingMock,
}))
vi.mock('$lib/server/billing/wallet', () => ({
  getWalletSnapshot: getWalletSnapshotMock,
}))
vi.mock('$lib/server/chat/chat-sessions', () => ({
  listChatSessions: listChatSessionsMock,
  loadChatSession: loadChatSessionMock,
}))
vi.mock('$lib/server/capture/load-recent-capture-thoughts', () => ({
  loadRecentCaptureThoughts: loadRecentCaptureThoughtsMock,
}))

import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { load } from './+page.server'

describe('chat page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkCaptureAllowedMock.mockResolvedValue({ allowed: true })
    isByokBillingMock.mockResolvedValue(false)
    getWalletSnapshotMock.mockResolvedValue({
      availableCredits: 0,
      reservedCredits: 0,
      pendingBillingMicroUsd: 0,
    })
    listChatSessionsMock.mockResolvedValue([{ id: 's1', title: 'Garden' }])
    loadChatSessionMock.mockResolvedValue(null)
    loadRecentCaptureThoughtsMock.mockResolvedValue({
      recentThoughts: [{ id: 't1', normalizedText: 'Plant tomatoes in May' }],
    })
  })

  const event = (search = '') =>
    ({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      url: new URL(`http://x/chat${search}`),
    }) as never

  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns capture gate and wallet shape without throwing when authenticated', async () => {
    const result = await load(event())

    expect(result.captureGate).toEqual({ allowed: true })
    expect(result.billingMode).toBe('platform_credits')
    expect(result.walletAvailableCredits).toBe(0)
    expect(result.minCaptureCredits).toBe(MIN_CAPTURE_PIPELINE_CREDITS)
    expect(checkCaptureAllowedMock).toHaveBeenCalledWith('u1')
    expect(isByokBillingMock).toHaveBeenCalledWith('u1')
    expect(getWalletSnapshotMock).toHaveBeenCalledWith('u1')
  })

  it('renders the session list and suggestions, and a blank conversation without ?session', async () => {
    const result = await load(event())
    expect(result.sessions).toEqual([{ id: 's1', title: 'Garden' }])
    expect(result.activeSessionId).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.suggestions.map((s) => s.text)).toEqual(['Plant tomatoes in May'])
    expect(loadChatSessionMock).not.toHaveBeenCalled()
  })

  it('renders the conversation named in ?session', async () => {
    loadChatSessionMock.mockResolvedValue({
      session: { id: 's1', title: 'Garden' },
      messages: [
        { id: 'm1', role: 'user', content: 'When do I plant?', metadata: null, createdAt: new Date() },
        { id: 'm2', role: 'assistant', content: 'In May.', metadata: null, createdAt: new Date() },
      ],
    })
    const result = await load(event('?session=s1'))
    expect(loadChatSessionMock).toHaveBeenCalledWith('s1')
    expect(result.activeSessionId).toBe('s1')
    expect(result.messages.map((m) => m.content)).toEqual(['When do I plant?', 'In May.'])
  })

  it('redirects to a blank Ask when ?session names no session', async () => {
    await expect(load(event('?session=gone'))).rejects.toMatchObject({ status: 303, location: '/chat' })
  })
})
