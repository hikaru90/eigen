import { describe, expect, it, vi } from 'vitest'
import { STT_MAX_AUDIO_BYTES, sttFormatFromMime } from '$lib/server/llm/stt-audio'
import { readAudioUpload } from './audio-upload'

function binaryRequest(
  body: Blob,
  {
    contentType,
    meta,
  }: { contentType?: string; meta?: Record<string, unknown> | string | null } = {},
) {
  const headers = new Headers()
  headers.set('content-type', contentType ?? (body.type || 'application/octet-stream'))
  if (meta !== null) {
    headers.set('x-audio-meta', typeof meta === 'string' ? meta : JSON.stringify(meta ?? {}))
  }
  return {
    headers,
    arrayBuffer: vi.fn(async () => body.arrayBuffer()),
    formData: vi.fn(async () => {
      throw new Error('formData() must not be called for binary bodies')
    }),
  } as unknown as Request
}

function multipartFormDataRequest(parts: { audio?: File; language?: string }) {
  const formData = new FormData()
  if (parts.audio) formData.append('audio', parts.audio)
  if (parts.language) formData.append('language', parts.language)
  return {
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }),
    arrayBuffer: vi.fn(async () => {
      throw new Error('arrayBuffer() must not be called for multipart bodies')
    }),
    formData: vi.fn(async () => formData),
  } as unknown as Request
}

describe('readAudioUpload', () => {
  it('parses a binary audio body with language metadata', async () => {
    const upload = await readAudioUpload(
      binaryRequest(new Blob([new Uint8Array(12)], { type: 'audio/webm' }), { meta: { language: 'EN' } }),
      STT_MAX_AUDIO_BYTES,
      sttFormatFromMime,
    )
    expect(upload.bytes).toHaveLength(12)
    expect(upload.mimeType).toBe('audio/webm')
    expect(upload.language).toBe('en')
  })

  it('defaults to application/octet-stream and no language when headers are absent', async () => {
    const req = binaryRequest(new Blob([new Uint8Array(8)], { type: 'audio/wav' }))
    ;(req.headers as Headers).delete('x-audio-meta')
    const upload = await readAudioUpload(req, STT_MAX_AUDIO_BYTES, sttFormatFromMime)
    expect(upload.mimeType).toBe('audio/wav')
    expect(upload.language).toBeUndefined()
  })

  it('rejects an empty binary body', async () => {
    await expect(
      readAudioUpload(
        binaryRequest(new Blob([new Uint8Array(0)], { type: 'audio/webm' })),
        STT_MAX_AUDIO_BYTES,
        sttFormatFromMime,
      ),
    ).rejects.toMatchObject({ status: 400, body: { message: 'audio file is empty' } })
  })

  it('enforces the byte ceiling on binary bodies', async () => {
    await expect(
      readAudioUpload(
        binaryRequest(new Blob([new Uint8Array(16)], { type: 'audio/webm' })),
        10,
        sttFormatFromMime,
      ),
    ).rejects.toMatchObject({ status: 400, body: { message: 'audio file exceeds 10 bytes' } })
  })

  it('rejects unsupported MIME types on binary bodies', async () => {
    await expect(
      readAudioUpload(
        binaryRequest(new Blob([new Uint8Array(8)], { type: 'text/plain' })),
        STT_MAX_AUDIO_BYTES,
        sttFormatFromMime,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('survives a malformed x-audio-meta header', async () => {
    const upload = await readAudioUpload(
      binaryRequest(new Blob([new Uint8Array(8)], { type: 'audio/webm' }), { meta: 'not-json{[' }),
      STT_MAX_AUDIO_BYTES,
      sttFormatFromMime,
    )
    expect(upload.language).toBeUndefined()
  })

  it('ignores a non-string language in x-audio-meta', async () => {
    const upload = await readAudioUpload(
      binaryRequest(new Blob([new Uint8Array(8)], { type: 'audio/webm' }), {
        meta: { language: 42 },
      }),
      STT_MAX_AUDIO_BYTES,
      sttFormatFromMime,
    )
    expect(upload.language).toBeUndefined()
  })

  it('reads the legacy multipart path (audio file + language field)', async () => {
    const upload = await readAudioUpload(
      multipartFormDataRequest({
        audio: new File([new Uint8Array(12)], 'recording.webm', { type: 'audio/webm' }),
        language: 'de',
      }),
      STT_MAX_AUDIO_BYTES,
      sttFormatFromMime,
    )
    expect(upload.bytes).toHaveLength(12)
    expect(upload.mimeType).toBe('audio/webm')
    expect(upload.language).toBe('de')
  })

  it('rejects legacy multipart uploads without an audio file', async () => {
    await expect(
      readAudioUpload(multipartFormDataRequest({}), STT_MAX_AUDIO_BYTES, sttFormatFromMime),
    ).rejects.toMatchObject({ status: 400 })
  })
})
