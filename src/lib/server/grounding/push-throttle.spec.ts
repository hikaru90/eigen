import { describe, expect, it } from 'vitest'
import { GROUNDING_PUSH_MIN_INTERVAL_MS } from '$lib/server/grounding/constants'
import { canSendGroundingPushToday } from '$lib/server/grounding/push-throttle'

describe('canSendGroundingPushToday', () => {
  const now = Date.parse('2026-07-22T12:00:00.000Z')

  it('allows when no prior push', () => {
    expect(canSendGroundingPushToday(null, now)).toBe(true)
    expect(canSendGroundingPushToday({ lastGroundingPushAt: null }, now)).toBe(true)
  })

  it('blocks when last push was within 24h', () => {
    expect(
      canSendGroundingPushToday(
        { lastGroundingPushAt: new Date(now - GROUNDING_PUSH_MIN_INTERVAL_MS + 1) },
        now,
      ),
    ).toBe(false)
  })

  it('allows when last push was at least 24h ago', () => {
    expect(
      canSendGroundingPushToday(
        { lastGroundingPushAt: new Date(now - GROUNDING_PUSH_MIN_INTERVAL_MS) },
        now,
      ),
    ).toBe(true)
  })
})
