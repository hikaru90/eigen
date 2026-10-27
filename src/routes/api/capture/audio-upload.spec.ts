import { describe, expect, it, vi } from 'vitest'
import { readAudioUpload } from './audio-upload'

function formatFromMime(mime: string): string | null {
  return { 'audio/webm': 'webm', 'audio/mp4': 'm4a' }[mime] ?? null
}

function audioRequest(
  body: Blob,
  { contentType, contentLength }: { contentType?: string; contentLength?: string | null } = {},
) {
  const headers = new Headers()
  headers.set('content-type', contentType ?? (body.type || 'application/octet-stream'))
  if (contentLength) headers.set('content-length', contentLength)
  return {
    headers,
    arrayBuffer: vi.fn(async () => body.arrayBuffer()),
    formData: vi.fn(async () => {
      throw new Error('formData() must not be called: audio arrives as a raw body')
    }),
  } as unknown as Request
}

describe('readAudioUpload', () => {
  it('reads a raw audio body: bytes, the MIME type and the format it maps to', async () => {
    const upload = await readAudioUpload(
      audioRequest(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })),
      1024,
      formatFromMime,
    )
    expect([...upload.bytes]).toEqual([1, 2, 3])
    expect(upload.mimeType).toBe('audio/webm')
    expect(upload.format).toBe('webm')
  })

  it('takes the MIME type from content-type and ignores its codecs parameter', async () => {
    const upload = await readAudioUpload(
      audioRequest(new Blob([new Uint8Array(4)]), { contentType: 'Audio/MP4; codecs=mp4a.40.2' }),
      1024,
      formatFromMime,
    )
    expect(upload.mimeType).toBe('audio/mp4')
    expect(upload.format).toBe('m4a')
  })

  it('carries nothing but the audio: no segment index, no language', async () => {
    const upload = await readAudioUpload(
      audioRequest(new Blob([new Uint8Array(8)], { type: 'audio/webm' })),
      1024,
      formatFromMime,
    )
    expect(Object.keys(upload).sort()).toEqual(['bytes', 'format', 'mimeType'])
  })

  it('rejects an empty body', async () => {
    await expect(
      readAudioUpload(
        audioRequest(new Blob([new Uint8Array(0)], { type: 'audio/webm' })),
        1024,
        formatFromMime,
      ),
    ).rejects.toMatchObject({ status: 400, body: { message: 'audio file is empty' } })
  })

  it('rejects an unsupported MIME type', async () => {
    await expect(
      readAudioUpload(
        audioRequest(new Blob([new Uint8Array(8)], { type: 'text/plain' })),
        1024,
        formatFromMime,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { message: 'unsupported audio type: text/plain' },
    })
  })

  it('names the byte limit and the five minutes when the clip is too large (AC-10)', async () => {
    await expect(
      readAudioUpload(
        audioRequest(new Blob([new Uint8Array(16)], { type: 'audio/webm' })),
        10,
        formatFromMime,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { message: 'audio clip exceeds 10 bytes (max 5 minutes)' },
    })
  })

  it('accepts a clip of exactly the limit', async () => {
    const upload = await readAudioUpload(
      audioRequest(new Blob([new Uint8Array(10)], { type: 'audio/webm' })),
      10,
      formatFromMime,
    )
    expect(upload.bytes).toHaveLength(10)
  })

  it('refuses an oversize clip from content-length alone, without reading the body', async () => {
    const request = audioRequest(new Blob([new Uint8Array(4)], { type: 'audio/webm' }), {
      contentLength: '999999',
    })
    await expect(readAudioUpload(request, 1024, formatFromMime)).rejects.toMatchObject({
      status: 400,
      body: { message: 'audio clip exceeds 1024 bytes (max 5 minutes)' },
    })
    expect(request.arrayBuffer).not.toHaveBeenCalled()
  })

  it('does not trust a smaller content-length: the body itself is measured', async () => {
    const request = audioRequest(new Blob([new Uint8Array(32)], { type: 'audio/webm' }), {
      contentLength: '4',
    })
    await expect(readAudioUpload(request, 16, formatFromMime)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('does not accept multipart: audio is a raw body only', async () => {
    const request = audioRequest(new Blob([new Uint8Array(8)]), {
      contentType: 'multipart/form-data; boundary=x',
    })
    await expect(readAudioUpload(request, 1024, formatFromMime)).rejects.toMatchObject({
      status: 400,
    })
    expect(request.formData).not.toHaveBeenCalled()
  })
})
