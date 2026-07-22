import { describe, expect, it } from 'vitest'
import {
  isPushSubscriptionInfrastructureError,
  parsePushSubscriptionBody,
  PUSH_SUBSCRIBE_USER_ERROR,
} from './subscription'

describe('parsePushSubscriptionBody', () => {
  it('accepts valid subscription JSON', () => {
    const input = parsePushSubscriptionBody({
      endpoint: 'https://push.example/send/abc',
      keys: { p256dh: 'key1', auth: 'key2' },
    })
    expect(input).toEqual({
      endpoint: 'https://push.example/send/abc',
      keys: { p256dh: 'key1', auth: 'key2' },
    })
  })

  it('rejects endpoint with interior whitespace', () => {
    expect(() =>
      parsePushSubscriptionBody({
        endpoint: 'https://push.example/a b',
        keys: { p256dh: 'k', auth: 'a' },
      }),
    ).toThrow(/whitespace/)
  })

  it('rejects missing keys', () => {
    expect(() => parsePushSubscriptionBody({ endpoint: 'https://push.example/x' })).toThrow(/keys/)
  })
})

describe('isPushSubscriptionInfrastructureError', () => {
  it('detects Drizzle Failed query dumps', () => {
    expect(
      isPushSubscriptionInfrastructureError(
        new Error(
          'Failed query: insert into "push_subscription" ("id", "user_id") values (default, $1)',
        ),
      ),
    ).toBe(true)
  })

  it('does not treat validation messages as infrastructure errors', () => {
    expect(isPushSubscriptionInfrastructureError(new Error('endpoint is required'))).toBe(false)
  })

  it('exports a user-safe subscribe error constant', () => {
    expect(PUSH_SUBSCRIBE_USER_ERROR.includes('Failed query')).toBe(false)
    expect(PUSH_SUBSCRIBE_USER_ERROR.length).toBeGreaterThan(20)
  })
})
