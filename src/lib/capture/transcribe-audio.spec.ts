import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMockInit, fetchMockUrl } from '$lib/test/vitest-mock-call'
import {
  appendVoiceTranscript,
  parseTranscribeErrorResponse,
  transcribeVoiceClip,
  TranscribeRequestError,
} from './transcribe-audio'

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
})

describe('parseTranscribeErrorResponse', () => {
  it('reads the json error', async () => {
    const res = new Response(JSON.stringify({ error: 'gateway down' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('gateway down')
  })

  it('falls back to the response text when the body is not JSON', async () => {
    const res = new Response('bad gateway', { status: 502 })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('bad gateway')
  })

  it('reads the one-shot body stream once', async () => {
    // Calling .json() then .text() surfaces as "body stream already read".
    const res = new Response('upstream html error page', { status: 502 })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('upstream html error page')
    expect(res.bodyUsed).toBe(true)
  })

  it('returns a status message when the body is empty', async () => {
    const res = new Response('', { status: 503 })
    await expect(parseTranscribeErrorResponse(res)).resolves.toBe('Transcription failed (503)')
  })
})

describe('transcribeVoiceClip', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: 'hello there' }),
      })),
    )
  })

  it('posts the whole clip once to /api/capture/transcribe', async () => {
    const clip = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' })
    const text = await transcribeVoiceClip(clip)
    expect(text).toBe('hello there')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetchMockUrl(vi.mocked(fetch))).toBe('/api/capture/transcribe')
    const init = fetchMockInit(vi.mocked(fetch))
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
  })

  it('sends a raw audio body, not FormData: raw audio types are exempt from the CSRF origin check', async () => {
    // SvelteKit rejects form-ish POSTs (multipart included) whose Origin differs from the
    // deployed ORIGIN with "Cross-site POST form submissions are forbidden" behind a proxy.
    const clip = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm;codecs=opus' })
    await transcribeVoiceClip(clip)
    const init = fetchMockInit(vi.mocked(fetch))
    expect(init.body).toBe(clip)
    expect(new Headers(init.headers as HeadersInit).get('content-type')).toBe(
      'audio/webm;codecs=opus',
    )
  })

  it('sends no metadata and no language hint: the model identifies the spoken language', async () => {
    await transcribeVoiceClip(new Blob([new Uint8Array([1])], { type: 'audio/mp4' }))
    const headers = new Headers(fetchMockInit(vi.mocked(fetch)).headers as HeadersInit)
    expect([...headers.keys()]).toEqual(['content-type'])
  })

  it('passes the abort signal on', async () => {
    const controller = new AbortController()
    await transcribeVoiceClip(new Blob(['x'], { type: 'audio/webm' }), { signal: controller.signal })
    expect(fetchMockInit(vi.mocked(fetch)).signal).toBe(controller.signal)
  })

  it('throws TranscribeRequestError with the status and the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'stt unavailable' }), { status: 502 })),
    )
    const err = await transcribeVoiceClip(new Blob(['x'], { type: 'audio/webm' })).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(TranscribeRequestError)
    expect((err as TranscribeRequestError).status).toBe(502)
    expect((err as TranscribeRequestError).message).toBe('stt unavailable')
  })

  it('keeps the 402 status and the billing message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'Insufficient credits' }), { status: 402 }),
      ),
    )
    await expect(
      transcribeVoiceClip(new Blob(['x'], { type: 'audio/webm' })),
    ).rejects.toMatchObject({ status: 402, message: 'Insufficient credits' })
  })

  it('throws when the transcript field is missing from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
    await expect(transcribeVoiceClip(new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow(
      /missing transcript/i,
    )
  })

  it('returns an empty string for a blank transcript: no speech is a valid answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ transcript: '   ' }) })),
    )
    await expect(transcribeVoiceClip(new Blob(['x'], { type: 'audio/webm' }))).resolves.toBe('')
  })

  it('lets a network failure through as it is (the session shows it as a failed request)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(transcribeVoiceClip(new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow(
      'Failed to fetch',
    )
  })
})
