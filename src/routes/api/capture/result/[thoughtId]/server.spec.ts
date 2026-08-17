import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { loadThoughtCaptureResultMock } = vi.hoisted(() => ({
  loadThoughtCaptureResultMock: vi.fn(),
}))

vi.mock('$lib/server/capture/capture-result', () => ({
  loadThoughtCaptureResult: loadThoughtCaptureResultMock,
}))

describe('GET /api/capture/result/[thoughtId]', () => {
  it('requires auth', async () => {
    await expect(
      GET({ locals: { user: null }, params: { thoughtId: 't1' } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('returns capture result', async () => {
    loadThoughtCaptureResultMock.mockResolvedValue({
      id: 't1',
      normalizedText: 'hello',
      category: 'thought',
      metadata: {},
      cues: [],
      enrichedAt: null,
      entities: [],
      temporalEvents: [],
      linkedThoughts: [],
      attachedFiles: [],
      enrichmentComplete: false,
    })
    const res = await GET({
      locals: { user: { id: 'u1' } },
      params: { thoughtId: 't1' },
    } as never)
    expect(res.status).toBe(200)
    expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 't1')
    const body = await res.json()
    expect(body.thought.id).toBe('t1')
  })

  it('returns 404 when thought is missing', async () => {
    loadThoughtCaptureResultMock.mockRejectedValue(new Error('not found'))
    await expect(
      GET({
        locals: { user: { id: 'u1' } },
        params: { thoughtId: 'missing' },
      } as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})
