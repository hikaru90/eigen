import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMockInit } from '$lib/test/vitest-mock-call'
import {
  appendVoiceTranscript,
  audioUploadExtension,
  parseTranscribeErrorResponse,
  transcribeRecordedAudio,
  transcribeAudioChunk,
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
    const body = fetchMockInit(fetchMock, 0).body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('audio')).toBeInstanceOf(File)
    expect(((body as FormData).get('audio') as File).name).toBe('recording.webm')
  })

  it('uploads wav recordings with a .wav filename', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })
    await transcribeRecordedAudio(blob)
    const body = fetchMockInit(vi.mocked(fetch), 0).body as FormData
    expect((body.get('audio') as File).name).toBe('recording.wav')
  })

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

  it('throws when transcription response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'stt unavailable' }), { status: 503 })),
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
