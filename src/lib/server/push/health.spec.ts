import { describe, expect, it } from 'vitest'
import { loadPushHealthSnapshot } from './health'

describe('loadPushHealthSnapshot', () => {
  it('reports configured when all VAPID env vars are present', () => {
    const snapshot = loadPushHealthSnapshot({
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:ops@example.com',
    })
    expect(snapshot).toEqual({
      vapidConfigured: true,
      vapidPublicKeyPresent: true,
      vapidPrivateKeyPresent: true,
      vapidSubjectPresent: true,
    })
  })

  it('reports missing pieces without throwing', () => {
    const snapshot = loadPushHealthSnapshot({
      VAPID_PUBLIC_KEY: 'pub',
    })
    expect(snapshot.vapidConfigured).toBe(false)
    expect(snapshot.vapidPublicKeyPresent).toBe(true)
    expect(snapshot.vapidPrivateKeyPresent).toBe(false)
    expect(snapshot.vapidSubjectPresent).toBe(false)
  })
})
