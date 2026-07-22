import { describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { requeueEnrichThoughtMock } = vi.hoisted(() => ({
  requeueEnrichThoughtMock: vi.fn(),
}))

vi.mock('$lib/server/capture/queue-capture', () => ({
  requeueEnrichThought: requeueEnrichThoughtMock,
}))

describe('POST /api/capture/enrich-retry', () => {
  it('requires auth', async () => {
    await expect(
      POST({
        locals: { user: null },
        request: new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ thoughtId: 't1' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('requires thoughtId', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when thought not found', async () => {
    requeueEnrichThoughtMock.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ thoughtId: 'missing' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns 409 when thought is not retryable', async () => {
    requeueEnrichThoughtMock.mockResolvedValue({ ok: false, reason: 'not_retryable' })
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ thoughtId: 't1' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('requeues thought and returns ok', async () => {
    requeueEnrichThoughtMock.mockResolvedValue({ ok: true })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ thoughtId: 't1' }),
      }),
    } as never)
    expect(res.status).toBe(200)
    expect(requeueEnrichThoughtMock).toHaveBeenCalledWith('u1', 't1')
    const body = await res.json()
    expect(body).toEqual({ ok: true, thoughtId: 't1' })
  })
})
