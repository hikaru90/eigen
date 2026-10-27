import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkCaptureAllowedMock,
  getWalletSnapshotMock,
  listChatSessionsMock,
  loadChatSessionMock,
  loadAskSuggestionsMock,
} = vi.hoisted(() => ({
  checkCaptureAllowedMock: vi.fn(),
  getWalletSnapshotMock: vi.fn(),
  listChatSessionsMock: vi.fn(),
  loadChatSessionMock: vi.fn(),
  loadAskSuggestionsMock: vi.fn(),
}))

vi.mock('$lib/server/onboarding/capture-gate', () => ({
  checkCaptureAllowed: checkCaptureAllowedMock,
}))
vi.mock('$lib/server/billing/wallet', () => ({
  getWalletSnapshot: getWalletSnapshotMock,
}))
vi.mock('$lib/server/chat/chat-sessions', () => ({
  listChatSessions: listChatSessionsMock,
  loadChatSession: loadChatSessionMock,
}))
vi.mock('$lib/server/chat/ask-suggestions', () => ({
  loadAskSuggestions: loadAskSuggestionsMock,
}))

import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { load } from './+page.server'

describe('chat page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkCaptureAllowedMock.mockResolvedValue({ allowed: true })
    getWalletSnapshotMock.mockResolvedValue({
      availableCredits: 0,
      reservedCredits: 0,
      pendingBillingMicroUsd: 0,
    })
    listChatSessionsMock.mockResolvedValue([{ id: 's1', title: 'Garden' }])
    loadChatSessionMock.mockResolvedValue(null)
    loadAskSuggestionsMock.mockResolvedValue([
      { thoughtId: 't1', question: 'When did I want to plant tomatoes?' },
    ])
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
    expect(result.walletAvailableCredits).toBe(0)
    expect(result.minCaptureCredits).toBe(MIN_CAPTURE_PIPELINE_CREDITS)
    expect(checkCaptureAllowedMock).toHaveBeenCalledWith('u1')
    expect(getWalletSnapshotMock).toHaveBeenCalledWith('u1')
  })

  it('renders the session list and suggestions, and a blank conversation without ?session', async () => {
    const result = await load(event())
    expect(result.sessions).toEqual([{ id: 's1', title: 'Garden' }])
    expect(result.activeSessionId).toBeNull()
    expect(result.messages).toEqual([])
    // stored enrichment questions, never raw thought text (SQ-4 / SQ-6)
    expect(result.suggestions).toEqual([
      { thoughtId: 't1', question: 'When did I want to plant tomatoes?' },
    ])
    expect(loadAskSuggestionsMock).toHaveBeenCalledWith('u1')
    expect(loadChatSessionMock).not.toHaveBeenCalled()
  })

  it('returns no suggestions when no thought has a question (AC-6)', async () => {
    loadAskSuggestionsMock.mockResolvedValue([])
    const result = await load(event())
    expect(result.suggestions).toEqual([])
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
