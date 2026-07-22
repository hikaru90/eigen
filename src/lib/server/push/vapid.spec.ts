import { describe, expect, it } from 'vitest'
import { readVapidConfigFromEnv } from './vapid'

describe('readVapidConfigFromEnv', () => {
  it('returns config when all vars are set', () => {
    const cfg = readVapidConfigFromEnv({
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:test@example.com',
    })
    expect(cfg).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:test@example.com',
    })
  })

  it('throws when VAPID_PUBLIC_KEY is missing', () => {
    expect(() =>
      readVapidConfigFromEnv({
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:a@b.com',
      }),
    ).toThrow(/VAPID_PUBLIC_KEY/)
  })
})
