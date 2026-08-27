import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { transcribeAudioMock } = vi.hoisted(() => ({
  transcribeAudioMock: vi.fn(),
}))

vi.mock('$lib/server/llm/stt-client', () => ({
  transcribeAudio: transcribeAudioMock,
}))

function makeAudioFile(size: number, type = 'audio/webm') {
  return new File([new Uint8Array(size)], 'recording.webm', { type })
}

function multipartRequest(files: { audio?: File; language?: string }) {
  const formData = new FormData()
  if (files.audio) formData.append('audio', files.audio)
  if (files.language) formData.append('language', files.language)
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'multipart/form-data; boundary=x' : null,
    },
    formData: vi.fn(async () => formData),
  }
}

describe('POST /api/capture/transcribe', () => {
  beforeEach(() => {
    transcribeAudioMock.mockReset()
  })

  describe('binary octet-stream upload (origin-header-safe)', () => {
    function binaryRequest(body: Blob, meta?: { language?: string }) {
      const headers = new Headers({ 'content-type': body.type || 'application/octet-stream' })
      if (meta?.language?.trim()) {
        headers.set('x-audio-meta', JSON.stringify({ language: meta.language.trim().toLowerCase() }))
      }
      return {
        headers,
        arrayBuffer: vi.fn(async () => body.arrayBuffer()),
      }
    }

    it('accepts a raw audio Blob without FormData', async () => {
      transcribeAudioMock.mockResolvedValue('hello world')
      const res = await POST({
        locals: { user: { id: 'u1' } },
        request: binaryRequest(new Blob([new Uint8Array(12)], { type: 'audio/webm' }), {
          language: 'en',
        }),
      } as never)
      expect(res.status).toBe(200)
      const payload = (await res.json()) as { transcript: string }
      expect(payload.transcript).toBe('hello world')
      expect(transcribeAudioMock).toHaveBeenCalledWith({
        userId: 'u1',
        audio: expect.objectContaining({ format: 'webm', language: 'en' }),
      })
    })

    it('falls back to application/octet-stream when the blob has no type', async () => {
      await expect(
        POST({
          locals: { user: { id: 'u1' } },
          request: binaryRequest(new Blob([new Uint8Array(12)])),
        } as never),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('ignores a malformed x-audio-meta header', async () => {
      transcribeAudioMock.mockResolvedValue('hello world')
      const blob = new Blob([new Uint8Array(12)], { type: 'audio/wav' })
      const req = binaryRequest(blob)
      ;(req.headers as Headers).set('x-audio-meta', 'not-json')
      const res = await POST({
        locals: { user: { id: 'u1' } },
        request: req,
      } as never)
      expect(res.status).toBe(200)
      expect(transcribeAudioMock).toHaveBeenCalledWith({
        userId: 'u1',
        audio: expect.objectContaining({ format: 'wav', language: undefined }),
      })
    })
  })

  it('requires auth', async () => {
    await expect(
      POST({ locals: { user: null }, request: multipartRequest({}) } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects JSON and form-urlencoded bodies (only audio uploads allowed)', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: {
          headers: { get: () => 'application/json' },
          arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
        },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: {
          headers: { get: () => 'application/x-www-form-urlencoded' },
          arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
        },
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('requires audio file', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: multipartRequest({}),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects empty audio', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: multipartRequest({ audio: makeAudioFile(0) }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects unsupported mime type', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: multipartRequest({ audio: makeAudioFile(8, 'audio/x-unknown') }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns transcript on success', async () => {
    transcribeAudioMock.mockResolvedValue('hello world')
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: multipartRequest({ audio: makeAudioFile(12), language: 'en' }),
    } as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { transcript: string }
    expect(body.transcript).toBe('hello world')
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      userId: 'u1',
      audio: expect.objectContaining({ format: 'webm', language: 'en' }),
    })
  })

  it('returns explicit error when transcription fails', async () => {
    transcribeAudioMock.mockRejectedValue(new Error('LLM STT HTTP 502'))
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: multipartRequest({ audio: makeAudioFile(12) }),
    } as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('502')
  })
})
