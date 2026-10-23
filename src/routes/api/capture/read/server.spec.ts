import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { interpretThoughtPreviewMock, queueCaptureMock, getDbMock } = vi.hoisted(() => ({
  interpretThoughtPreviewMock: vi.fn(),
  queueCaptureMock: vi.fn(),
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/capture/interpret-thought', () => ({
  interpretThoughtPreview: interpretThoughtPreviewMock,
}))

// The read endpoint must never reach the persistence layer: these mocks exist only to
// prove nothing is queued or written while the mesh reads.
vi.mock('$lib/server/capture/queue-capture', () => ({
  queueCapture: queueCaptureMock,
  QUEUE_PLACEHOLDER_CATEGORY: 'observation',
}))
vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

const PREVIEW = {
  interpretedText: 'Call the studio about the frame order.',
  category: { key: 'task', confidence: 0.9, alternatives: [{ key: 'idea', confidence: 0.05 }] },
  entities: [],
  deviatesFromVerbatim: true,
}

describe('POST /api/capture/read (preview only — nothing persists)', () => {
  beforeEach(() => {
    interpretThoughtPreviewMock.mockReset()
    queueCaptureMock.mockReset()
    getDbMock.mockReset()
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
        request: { json: vi.fn(async () => ({ raw: '   ' })) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
    expect(interpretThoughtPreviewMock).not.toHaveBeenCalled()
  })

  it('returns the preview bundle and touches neither the queue nor the database', async () => {
    interpretThoughtPreviewMock.mockResolvedValue(PREVIEW)
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ raw: 'call the studio about the frame order' })) },
    } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ preview: PREVIEW })
    expect(interpretThoughtPreviewMock).toHaveBeenCalledTimes(1)
    expect(interpretThoughtPreviewMock).toHaveBeenCalledWith({
      userId: 'u1',
      rawText: 'call the studio about the frame order',
    })
    expect(queueCaptureMock).not.toHaveBeenCalled()
    expect(getDbMock).not.toHaveBeenCalled()
  })

  it('surfaces interpret failures with the capture-gate error shape (no fallback preview)', async () => {
    interpretThoughtPreviewMock.mockRejectedValue(new Error('LLM unavailable'))
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ raw: 'call the studio about the frame order' })) },
    } as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('LLM unavailable')
    expect(body.preview).toBeUndefined()
    expect(queueCaptureMock).not.toHaveBeenCalled()
  })
})
