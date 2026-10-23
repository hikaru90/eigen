import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { keepCaptureWithReadingMock } = vi.hoisted(() => ({
  keepCaptureWithReadingMock: vi.fn(),
}))

vi.mock('$lib/server/capture/capture-confirmation', () => ({
  keepCaptureWithReading: keepCaptureWithReadingMock,
}))

const READING = {
  interpretedText: 'Call the studio about the frame order.',
  category: { key: 'task', confidence: 0.9, alternatives: [] },
  entities: [],
  deviatesFromVerbatim: true,
}

const KEPT = {
  thoughtId: 'thought-1',
  rawText: 'call the studio about the frame order',
  normalizedText: 'Call the studio about the frame order.',
  category: 'task',
  queueStatus: 'pending',
  preview: READING,
}

describe('POST /api/capture/keep (persist the accepted reading, once)', () => {
  beforeEach(() => {
    keepCaptureWithReadingMock.mockReset()
  })

  it('requires auth', async () => {
    await expect(
      POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('requires raw and a reading', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => ({ reading: READING })) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => ({ raw: 'hello there' })) },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
    expect(keepCaptureWithReadingMock).not.toHaveBeenCalled()
  })

  it('keeps the raw words with the accepted reading and returns the confirmed result', async () => {
    keepCaptureWithReadingMock.mockResolvedValue(KEPT)
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: {
        json: vi.fn(async () => ({ raw: 'call the studio about the frame order', reading: READING })),
      },
    } as never)
    expect(res.status).toBe(200)
    expect(keepCaptureWithReadingMock).toHaveBeenCalledTimes(1)
    expect(keepCaptureWithReadingMock).toHaveBeenCalledWith(
      'u1',
      'call the studio about the frame order',
      READING,
      { source: 'ui' },
    )
    const body = await res.json()
    expect(body.thoughtId).toBe('thought-1')
    expect(body.normalizedText).toBe('Call the studio about the frame order.')
    expect(body.rawText).toBe('call the studio about the frame order')
  })

  it('passes a valid captured_at through and rejects an invalid one', async () => {
    keepCaptureWithReadingMock.mockResolvedValue(KEPT)
    await POST({
      locals: { user: { id: 'u1' } },
      request: {
        json: vi.fn(async () => ({
          raw: 'hello there',
          reading: READING,
          captured_at: '2026-10-20T10:00:00.000Z',
        })),
      },
    } as never)
    expect(keepCaptureWithReadingMock).toHaveBeenCalledWith('u1', 'hello there', READING, {
      source: 'ui',
      capturedAt: new Date('2026-10-20T10:00:00.000Z'),
    })

    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: {
          json: vi.fn(async () => ({ raw: 'hello there', reading: READING, captured_at: 'yesterday' })),
        },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('reports failures with the submit error shape (error + details), never a fake success', async () => {
    keepCaptureWithReadingMock.mockRejectedValue(
      new Error('reading.category.key must be a non-empty string'),
    )
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: {
        json: vi.fn(async () => ({ raw: 'hello there', reading: { interpretedText: 'x' } })),
      },
    } as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('reading.category.key must be a non-empty string')
    expect(body.details).toEqual(['reading.category.key must be a non-empty string'])
  })
})
