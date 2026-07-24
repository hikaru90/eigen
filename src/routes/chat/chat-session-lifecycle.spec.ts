import { describe, expect, it } from 'vitest'
import {
  CHAT_ACTIVE_SESSION_STORAGE_KEY,
  CHAT_PREFER_BLANK_STORAGE_KEY,
  clearChatPreferBlank,
  readChatPreferBlank,
  resolveChatBootstrapSelection,
  setChatPreferBlank,
  shouldApplyLoadedSessionMessages,
  shouldReplaceMessagesWithSessionLoad,
} from './chat-session-lifecycle'

describe('resolveChatBootstrapSelection', () => {
  const sessions = [{ id: 'newest' }, { id: 'older' }]

  it('restores the stored session when it still exists', () => {
    expect(
      resolveChatBootstrapSelection({
        storedId: 'older',
        sessions,
        preferBlank: false,
      }),
    ).toEqual({ type: 'session', sessionId: 'older' })
  })

  it('falls back to the newest session when nothing is stored', () => {
    expect(
      resolveChatBootstrapSelection({
        storedId: null,
        sessions,
        preferBlank: false,
      }),
    ).toEqual({ type: 'session', sessionId: 'newest' })
  })

  it('stays blank after New chat even when sessions exist', () => {
    expect(
      resolveChatBootstrapSelection({
        storedId: null,
        sessions,
        preferBlank: true,
      }),
    ).toEqual({ type: 'blank' })
  })

  it('stays blank after New chat even if a stale stored id is still present', () => {
    expect(
      resolveChatBootstrapSelection({
        storedId: 'newest',
        sessions,
        preferBlank: true,
      }),
    ).toEqual({ type: 'blank' })
  })

  it('stays blank when there are no sessions', () => {
    expect(
      resolveChatBootstrapSelection({
        storedId: null,
        sessions: [],
        preferBlank: false,
      }),
    ).toEqual({ type: 'blank' })
  })

  it('clears a stored id that no longer exists and falls back to newest', () => {
    expect(
      resolveChatBootstrapSelection({
        storedId: 'deleted',
        sessions,
        preferBlank: false,
      }),
    ).toEqual({ type: 'session', sessionId: 'newest' })
  })
})

describe('shouldReplaceMessagesWithSessionLoad', () => {
  it('blocks session reloads while a stream is in flight', () => {
    expect(shouldReplaceMessagesWithSessionLoad({ streaming: true })).toBe(false)
  })

  it('allows session reloads when idle', () => {
    expect(shouldReplaceMessagesWithSessionLoad({ streaming: false })).toBe(true)
  })
})

describe('shouldApplyLoadedSessionMessages', () => {
  it('applies a load that still matches the current epoch while idle', () => {
    expect(
      shouldApplyLoadedSessionMessages({ loadEpoch: 3, currentEpoch: 3, streaming: false }),
    ).toBe(true)
  })

  it('drops a stale load after New chat or a newer select bumps the epoch', () => {
    expect(
      shouldApplyLoadedSessionMessages({ loadEpoch: 2, currentEpoch: 3, streaming: false }),
    ).toBe(false)
  })

  it('drops a load that finishes while a stream is in flight', () => {
    expect(
      shouldApplyLoadedSessionMessages({ loadEpoch: 3, currentEpoch: 3, streaming: true }),
    ).toBe(false)
  })
})

describe('chat prefer-blank storage helpers', () => {
  it('round-trips the prefer-blank flag through localStorage keys', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }

    expect(CHAT_ACTIVE_SESSION_STORAGE_KEY).toBe('chat-active-session-id')
    expect(CHAT_PREFER_BLANK_STORAGE_KEY).toBe('chat-prefer-blank-session')
    expect(readChatPreferBlank(storage)).toBe(false)

    setChatPreferBlank(storage)
    expect(readChatPreferBlank(storage)).toBe(true)
    expect(store.get(CHAT_PREFER_BLANK_STORAGE_KEY)).toBe('1')

    clearChatPreferBlank(storage)
    expect(readChatPreferBlank(storage)).toBe(false)
  })
})
