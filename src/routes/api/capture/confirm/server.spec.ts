import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { confirmCapturePreviewMock } = vi.hoisted(() => ({
  confirmCapturePreviewMock: vi.fn(),
}))

vi.mock('$lib/server/capture/capture-confirmation', () => ({
  confirmCapturePreview: confirmCapturePreviewMock,
}))

describe('POST /api/capture/confirm', () => {
  beforeEach(() => {
    confirmCapturePreviewMock.mockReset()
  })

  it('requires auth', async () => {
    await expect(
      POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('requires thoughtId', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => ({})) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns confirmed thought and promotes to pending enrich', async () => {
    confirmCapturePreviewMock.mockResolvedValue({
      thoughtId: 't1',
      rawText: 'hello',
      normalizedText: 'Hello.',
      category: 'observation',
      memoryType: 'fact',
      queueStatus: 'pending',
      preview: {
        interpretedText: 'Hello.',
        category: { key: 'observation', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
        deviatesFromVerbatim: true,
      },
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ thoughtId: 't1' })) },
    } as never)
    expect(confirmCapturePreviewMock).toHaveBeenCalledWith('u1', 't1', { verbatim: false })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.queueStatus).toBe('pending')
    expect(body.normalizedText).toBe('Hello.')
  })

  it('passes verbatim:true through to confirmCapturePreview', async () => {
    confirmCapturePreviewMock.mockResolvedValue({
      thoughtId: 't1',
      rawText: 'hello',
      normalizedText: 'hello',
      category: 'observation',
      memoryType: null,
      queueStatus: 'pending',
      preview: {
        interpretedText: 'Hello.',
        category: { key: 'observation', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
        deviatesFromVerbatim: true,
      },
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ thoughtId: 't1', verbatim: true })) },
    } as never)
    expect(confirmCapturePreviewMock).toHaveBeenCalledWith('u1', 't1', { verbatim: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.normalizedText).toBe('hello')
    expect(body.memoryType).toBeNull()
  })
})
