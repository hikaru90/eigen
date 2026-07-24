import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { interpretAndQueueCaptureMock } = vi.hoisted(() => ({
  interpretAndQueueCaptureMock: vi.fn(),
}))

vi.mock('$lib/server/capture/capture-confirmation', () => ({
  interpretAndQueueCapture: interpretAndQueueCaptureMock,
}))

describe('POST /api/capture/interpret', () => {
  beforeEach(() => {
    interpretAndQueueCaptureMock.mockReset()
  })

  it('requires auth', async () => {
    await expect(
      POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('requires raw input', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => ({})) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns preview draft when payload is valid', async () => {
    interpretAndQueueCaptureMock.mockResolvedValue({
      thoughtId: 't1',
      rawText: 'hello',
      preview: {
        interpretedText: 'Hello.',
        category: { key: 'observation', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
      },
      queueStatus: 'awaiting_confirmation',
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ raw: 'hello' })) },
    } as never)
    expect(interpretAndQueueCaptureMock).toHaveBeenCalledWith('u1', 'hello', { source: 'ui' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.thoughtId).toBe('t1')
    expect(body.queueStatus).toBe('awaiting_confirmation')
    expect(body.preview.interpretedText).toBe('Hello.')
  })
})
