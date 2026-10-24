import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMockInit } from '$lib/test/vitest-mock-call'
import {
  appendVoiceTranscript,
  audioUploadExtension,
  parseTranscribeErrorResponse,
  transcribeAudioChunk,
  TranscribeRequestError,
} from './transcribe-audio'

describe('audioUploadExtension', () => {
  it('maps wav MIME to .wav (not default .webm)', () => {
    expect(audioUploadExtension('audio/wav')).toBe('wav')
    expect(audioUploadExtension('audio/wave')).toBe('wav')
  })

  it('maps webm and ogg', () => {
    expect(audioUploadExtension('audio/webm;codecs=opus')).toBe('webm')
    expect(audioUploadExtension('audio/ogg')).toBe('ogg')
  })
})

describe('appendVoiceTranscript', () => {
  it('appends transcript to a non-empty draft with a single space', () => {
    expect(appendVoiceTranscript('Foo', 'bar')).toBe('Foo bar')
  })

  it('returns the transcript alone when the draft is empty', () => {
    expect(appendVoiceTranscript('', 'bar')).toBe('bar')
    expect(appendVoiceTranscript('   ', 'bar')).toBe('bar')
  })

  it('returns the draft unchanged when the transcript is empty', () => {
    expect(appendVoiceTranscript('Foo', '')).toBe('Foo')
    expect(appendVoiceTranscript('Foo', '   ')).toBe('Foo')
  })

  it('collapses surrounding whitespace and avoids double spaces', () => {
    expect(appendVoiceTranscript('Foo   ', '   bar')).toBe('Foo bar')
  })

  it('recomputes from the original draft on every cumulative partial (no duplication)', () => {
    const draft = 'Foo'
    expect(appendVoiceTranscript(draft, 'hello')).toBe('Foo hello')
    expect(appendVoiceTranscript(draft, 'hello world')).toBe('Foo hello world')
  })
})

describe('parseTranscribeErrorResponse', () => {
  it('parseTranscribeErrorResponse reads json error', async () => {
    const res = new Response(JSON.stringify({ error: 'gateway down' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('gateway down')
  })

  it('parseTranscribeErrorResponse falls back to response text when body is not JSON', async () => {
    const res = new Response('bad gateway', { status: 502 })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('bad gateway')
  })

  it('parseTranscribeErrorResponse does not throw when the body stream is one-shot', async () => {
    // Real Response bodies can be read only once. Calling .json() then .text()
    // surfaces as "body stream already read" / "Stream Response has already been read".
    const res = new Response('upstream html error page', { status: 502 })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('upstream html error page')
    expect(res.bodyUsed).toBe(true)
  })

  it('parseTranscribeErrorResponse returns status fallback when body is empty', async () => {
    const res = new Response('', { status: 503 })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('Transcription failed (503)')
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
    const text = await transcribeAudioChunk(blob)
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

  it('throws TranscribeRequestError with status and server message on failure (no silent empty partial)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'stt unavailable' }), { status: 503 })),
    )
    const err = await transcribeAudioChunk(new Blob(['x'], { type: 'audio/webm' })).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(TranscribeRequestError)
    expect((err as TranscribeRequestError).status).toBe(503)
    expect((err as TranscribeRequestError).message).toBe('stt unavailable')
  })

  it('keeps the 402 status so the caller can skip retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Insufficient credits' }), { status: 402 })),
    )
    await expect(
      transcribeAudioChunk(new Blob(['x'], { type: 'audio/webm' })),
    ).rejects.toMatchObject({ status: 402, message: 'Insufficient credits' })
  })

  it('throws when the transcript field is missing from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
    await expect(
      transcribeAudioChunk(new Blob(['x'], { type: 'audio/webm' })),
    ).rejects.toThrow(/missing transcript/i)
  })

  it('keeps the audio MIME type exact (wav fixtures are not re-labeled)', async () => {
    await transcribeAudioChunk(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))
    const init = fetchMockInit(vi.mocked(fetch), 0)
    expect(init.body).toBeInstanceOf(Blob)
    expect(new Headers(init.headers as HeadersInit).get('content-type')).toBe('audio/wav')
  })

  it('returns empty string when transcript is blank (silence is a valid result)', async () => {
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
