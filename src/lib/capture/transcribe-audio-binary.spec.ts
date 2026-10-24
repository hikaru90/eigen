import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMockInit } from '$lib/test/vitest-mock-call'
import { transcribeAudioChunk } from './transcribe-audio'

/**
 * SvelteKit's CsrfGuard rejects POSTs whose content-type is form-ish
 * (`multipart/form-data` included) when the `Origin` header does not match the
 * app origin (SvelteKit `respond` in @sveltejs/kit). In production behind a
 * reverse proxy (adapter-node + Traefik/Caddy), a stale `ORIGIN` env — e.g.
 * left at the dev value `http://localhost:5173` while the browser origin is
 * `https://eigenmesh.xyz` — makes every multipart upload 403 with
 * "Cross-site POST form submissions are forbidden".
 *
 * The voice-upload client must therefore send audio as a non-form binary body
 * (`application/octet-stream`) with structured metadata in a JSON header —
 * those content types are exempt from the origin check.
 */

describe('transcribe-audio binary upload (CSRF/origin-safe content-type)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: 'hello there' }),
      })),
    )
  })

  it('transcribeAudioChunk posts octet-stream body, not FormData', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' })
    await transcribeAudioChunk(blob)
    const init = fetchMockInit(vi.mocked(fetch), 0)
    expect(init.body).toBeInstanceOf(Blob)
    expect((init.body as Blob).type).toBe('audio/webm')
  })

  it('transcribeAudioChunk sends no language hint: the model identifies the spoken language', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/wav' })
    await transcribeAudioChunk(blob)
    const init = fetchMockInit(vi.mocked(fetch), 0)
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('content-type')).toBe('audio/wav')
    expect(headers.get('x-audio-meta')).toBeNull()
  })

  it('transcribeAudioChunk sends the client segment index in x-audio-meta', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm;codecs=opus' })
    const text = await transcribeAudioChunk(blob, { segment: 4 })
    expect(text).toBe('hello there')
    const init = fetchMockInit(vi.mocked(fetch), 0)
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('content-type')).toBe('audio/webm;codecs=opus')
    expect(JSON.parse(headers.get('x-audio-meta') ?? '{}')).toEqual({ segment: 4 })
  })

  it('keeps credentials: same-origin and pass the abort signal', async () => {
    const controller = new AbortController()
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    await transcribeAudioChunk(blob, { signal: controller.signal })
    const init = fetchMockInit(vi.mocked(fetch), 0)
    expect(init.credentials).toBe('same-origin')
    expect(init.signal).toBe(controller.signal)
  })
})
