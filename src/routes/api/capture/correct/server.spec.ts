import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { correctCapturePreviewMock } = vi.hoisted(() => ({
  correctCapturePreviewMock: vi.fn(),
}))

vi.mock('$lib/server/capture/capture-confirmation', () => ({
  correctCapturePreview: correctCapturePreviewMock,
}))

describe('POST /api/capture/correct', () => {
  beforeEach(() => {
    correctCapturePreviewMock.mockReset()
  })

  it('requires auth', async () => {
    await expect(
      POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('requires thoughtId and correction', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => ({ thoughtId: 't1' })) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns updated preview', async () => {
    correctCapturePreviewMock.mockResolvedValue({
      thoughtId: 't1',
      rawText: 'hello',
      preview: {
        interpretedText: 'Hello world.',
        category: { key: 'observation', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
      },
      queueStatus: 'awaiting_confirmation',
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: {
        json: vi.fn(async () => ({ thoughtId: 't1', correction: 'add world' })),
      },
    } as never)
    expect(correctCapturePreviewMock).toHaveBeenCalledWith('u1', 't1', 'add world')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preview.interpretedText).toBe('Hello world.')
  })
})
