import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { interpretAndQueueCaptureMock, allowForceMock } = vi.hoisted(() => ({
  interpretAndQueueCaptureMock: vi.fn(),
  allowForceMock: vi.fn(() => true),
}))

vi.mock('$lib/server/capture/capture-confirmation', () => ({
  interpretAndQueueCapture: interpretAndQueueCaptureMock,
  allowCaptureForceConfirmation: allowForceMock,
}))

describe('POST /api/capture/interpret', () => {
  beforeEach(() => {
    interpretAndQueueCaptureMock.mockReset()
    allowForceMock.mockReset()
    allowForceMock.mockReturnValue(true)
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

  it('returns awaiting_confirmation draft when LLM deviates', async () => {
    interpretAndQueueCaptureMock.mockResolvedValue({
      status: 'awaiting_confirmation',
      thoughtId: 't1',
      rawText: 'hello',
      preview: {
        interpretedText: 'Hello.',
        category: { key: 'observation', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
        deviatesFromVerbatim: true,
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
    expect(body.status).toBe('awaiting_confirmation')
    expect(body.thoughtId).toBe('t1')
    expect(body.queueStatus).toBe('awaiting_confirmation')
    expect(body.preview.interpretedText).toBe('Hello.')
  })

  it('returns ingested when LLM does not deviate', async () => {
    interpretAndQueueCaptureMock.mockResolvedValue({
      status: 'ingested',
      thoughtId: 't2',
      rawText: 'buy oat milk',
      normalizedText: 'Buy oat milk',
      category: 'task',
      memoryType: 'fact',
      preview: {
        interpretedText: 'Buy oat milk',
        category: { key: 'task', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
        deviatesFromVerbatim: false,
      },
      queueStatus: 'pending',
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ raw: 'buy oat milk' })) },
    } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ingested')
    expect(body.queueStatus).toBe('pending')
    expect(body.normalizedText).toBe('Buy oat milk')
  })

  it('forwards forceConfirmation to interpretAndQueueCapture in non-production', async () => {
    interpretAndQueueCaptureMock.mockResolvedValue({
      status: 'awaiting_confirmation',
      thoughtId: 't3',
      rawText: 'hello',
      preview: {
        interpretedText: 'Hello.',
        category: { key: 'observation', confidence: 0.9, alternatives: [] },
        memoryType: 'fact',
        entities: [],
        deviatesFromVerbatim: true,
      },
      queueStatus: 'awaiting_confirmation',
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { json: vi.fn(async () => ({ raw: 'hello', forceConfirmation: true })) },
    } as never)
    expect(res.status).toBe(200)
    expect(interpretAndQueueCaptureMock).toHaveBeenCalledWith('u1', 'hello', {
      source: 'ui',
      forceConfirmation: true,
    })
  })

  it('rejects forceConfirmation when not allowed', async () => {
    allowForceMock.mockReturnValue(false)
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => ({ raw: 'hello', forceConfirmation: true })) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
    expect(interpretAndQueueCaptureMock).not.toHaveBeenCalled()
  })
})
