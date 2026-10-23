import { describe, expect, it } from 'vitest'
import {
  shouldApplyLoadedSessionMessages,
  shouldReplaceMessagesWithSessionLoad,
} from './chat-session-lifecycle'

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
