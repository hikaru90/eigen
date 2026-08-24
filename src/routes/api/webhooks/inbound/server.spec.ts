import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { getDbMock, decryptMock, validateMock, runAgentMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  decryptMock: vi.fn(),
  validateMock: vi.fn(() => true),
  runAgentMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptMock,
}))

vi.mock('$lib/server/agents/sign', () => ({
  validateWebhookSignature: validateMock,
}))

vi.mock('$lib/server/agents/run-agent', () => ({
  runAgentWithEvent: runAgentMock,
}))

describe('POST /api/webhooks/inbound/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateMock.mockReturnValue(true)
    runAgentMock.mockResolvedValue({ agentRunId: 'run-1' })
  })

  function inboundEvent(pathSuffix: string, init?: RequestInit) {
    const url = new URL(`/api/webhooks/inbound/${pathSuffix}`, 'http://localhost')
    return {
      url,
      request: new Request(url, { method: 'POST', ...init }),
    }
  }

  function mockSubscription(row: Record<string, unknown> | null) {
    const limit = vi.fn(async () => (row ? [row] : []))
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })
  }

  it('rejects missing slug', async () => {
    const url = new URL('http://localhost/api/webhooks/inbound/')
    await expect(
      POST({
        url,
        request: new Request(url, { method: 'POST', body: '{}' }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('404 when subscription missing', async () => {
    mockSubscription(null)
    await expect(
      POST({
        ...inboundEvent('missing'),
        request: new Request('http://localhost/api/webhooks/inbound/missing', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'ping' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('ignores unsubscribed event types', async () => {
    mockSubscription({
      id: 's1',
      userId: 'u1',
      slug: 'hook',
      enabled: true,
      signatureMode: 'generic',
      subscribedEvents: ['push'],
      signingSecretEncrypted: null,
      agentId: null,
    })
    const res = await POST({
      ...inboundEvent('hook'),
      request: new Request('http://localhost/api/webhooks/inbound/hook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-event-type': 'other',
        },
        body: JSON.stringify({}),
      }),
    } as never)
    expect(await res.json()).toMatchObject({ received: true, ignored: true })
  })

  it('accepts generic webhook without signature when secret unset', async () => {
    mockSubscription({
      id: 's1',
      userId: 'u1',
      slug: 'hook',
      enabled: true,
      signatureMode: 'generic',
      subscribedEvents: [],
      signingSecretEncrypted: null,
      agentId: null,
    })
    const res = await POST({
      ...inboundEvent('hook'),
      request: new Request('http://localhost/api/webhooks/inbound/hook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-event-type': 'ping',
          'x-request-id': 'del-1',
        },
        body: JSON.stringify({ hello: true }),
      }),
    } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      received: true,
      eventType: 'ping',
      deliveryId: 'del-1',
    })
  })

  it('rejects invalid signature when secret configured', async () => {
    mockSubscription({
      id: 's1',
      userId: 'u1',
      slug: 'hook',
      enabled: true,
      signatureMode: 'generic',
      subscribedEvents: [],
      signingSecretEncrypted: 'enc',
      agentId: null,
    })
    decryptMock.mockResolvedValue('secret')
    validateMock.mockReturnValue(false)
    await expect(
      POST({
        ...inboundEvent('hook'),
        request: new Request('http://localhost/api/webhooks/inbound/hook', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': 'bad',
          },
          body: JSON.stringify({}),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })
})
