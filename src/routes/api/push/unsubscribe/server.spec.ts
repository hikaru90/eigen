import { describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { deletePushSubscriptionByEndpointMock } = vi.hoisted(() => ({
  deletePushSubscriptionByEndpointMock: vi.fn(),
}))

vi.mock('$lib/server/push/subscription', () => ({
  deletePushSubscriptionByEndpoint: deletePushSubscriptionByEndpointMock,
}))

describe('POST /api/push/unsubscribe', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(
      POST({
        locals: { user: null },
        request: new Request('http://localhost/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: 'https://push.example/x' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when endpoint is missing', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: '   ' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('removes subscription by endpoint for authenticated user', async () => {
    deletePushSubscriptionByEndpointMock.mockResolvedValue(true)

    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example/x' }),
      }),
    } as never)

    expect(deletePushSubscriptionByEndpointMock).toHaveBeenCalledWith('https://push.example/x')
    expect(await res.json()).toEqual({ ok: true, removed: true })
  })

  it('returns removed false when subscription was not found', async () => {
    deletePushSubscriptionByEndpointMock.mockResolvedValue(false)

    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example/missing' }),
      }),
    } as never)

    expect(await res.json()).toEqual({ ok: true, removed: false })
  })

  it('returns 500 when delete fails', async () => {
    deletePushSubscriptionByEndpointMock.mockRejectedValue(new Error('db down'))

    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: 'https://push.example/x' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 500 })
  })
})
