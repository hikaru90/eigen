import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseTranscribeErrorResponse,
  transcribeRecordedAudio,
  transcribeAudioChunk,
} from './transcribe-audio'

describe('transcribe-audio client', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: 'hello there' }),
      })),
    )
  })

  it('posts multipart audio to transcribe endpoint', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' })
    const text = await transcribeRecordedAudio(blob, { language: 'en' })
    expect(text).toBe('hello there')
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/capture/transcribe',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
    const body = fetchMock.mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
  })

  it('parseTranscribeErrorResponse reads json error', async () => {
    const res = {
      status: 500,
      json: async () => ({ error: 'gateway down' }),
      text: async () => '',
    } as Response
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('gateway down')
  })

  it('parseTranscribeErrorResponse falls back to response text', async () => {
    const res = {
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
      text: async () => 'bad gateway',
    } as Response
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('bad gateway')
  })

  it('throws when transcription response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'stt unavailable' }),
      })),
    )

    await expect(transcribeRecordedAudio(new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow(
      'stt unavailable',
    )
  })

  it('throws when transcript is missing from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: '   ' }),
      })),
    )

    await expect(transcribeRecordedAudio(new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow(
      /missing transcript/i,
    )
  })
})

describe('transcribeAudioChunk', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: 'partial hello' }),
      })),
    )
  })

  it('posts chunk to transcribe-chunk endpoint', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' })
    const text = await transcribeAudioChunk(blob, { language: 'en' })
    expect(text).toBe('partial hello')
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/capture/transcribe-chunk',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })

  it('returns empty string on failure instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'stt unavailable' }),
      })),
    )
    const blob = new Blob(['x'], { type: 'audio/webm' })
    const text = await transcribeAudioChunk(blob)
    expect(text).toBe('')
  })

  it('returns empty string when transcript is blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: '   ' }),
      })),
    )
    const blob = new Blob(['x'], { type: 'audio/webm' })
    const text = await transcribeAudioChunk(blob)
    expect(text).toBe('')
  })
})
