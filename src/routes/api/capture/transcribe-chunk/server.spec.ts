import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STT_SEGMENT_MAX_AUDIO_BYTES } from '$lib/server/llm/stt-audio'
import { POST } from './+server'

const { transcribeAudioMock } = vi.hoisted(() => ({
  transcribeAudioMock: vi.fn(),
}))

vi.mock('$lib/server/llm/stt-client', () => ({
  transcribeAudio: transcribeAudioMock,
}))

function makeChunkFile(size: number, type = 'audio/webm') {
  return new File([new Uint8Array(size)], 'chunk.webm', { type })
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

describe('POST /api/capture/transcribe-chunk', () => {
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
      transcribeAudioMock.mockResolvedValue('hello there')
      const res = await POST({
        locals: { user: { id: 'u1' } },
        request: binaryRequest(new Blob([new Uint8Array(12)], { type: 'audio/webm' }), {
          language: 'de',
        }),
      } as never)
      expect(res.status).toBe(200)
      const payload = (await res.json()) as { transcript: string }
      expect(payload.transcript).toBe('hello there')
      expect(transcribeAudioMock).toHaveBeenCalledWith({
        userId: 'u1',
        audio: { bytes: expect.any(Uint8Array), format: 'webm' },
      })
    })

    it('rejects an unsupported MIME type carried by the binary body', async () => {
      await expect(
        POST({
          locals: { user: { id: 'u1' } },
          request: binaryRequest(new Blob([new Uint8Array(12)], { type: 'audio/x-unknown' })),
        } as never),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  it('requires auth', async () => {
    await expect(
      POST({ locals: { user: null }, request: multipartRequest({}) } as never),
    ).rejects.toMatchObject({ status: 401 })
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
        request: multipartRequest({ audio: makeChunkFile(0) }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a segment above the 10 s ceiling with the limit in the message', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: multipartRequest({ audio: makeChunkFile(STT_SEGMENT_MAX_AUDIO_BYTES + 1) }),
      } as never),
    ).rejects.toMatchObject({
      status: 400,
      body: { message: expect.stringContaining(`${STT_SEGMENT_MAX_AUDIO_BYTES} bytes`) },
    })
    expect(transcribeAudioMock).not.toHaveBeenCalled()
  })

  it('accepts a single segment at the ceiling and echoes the segment index', async () => {
    transcribeAudioMock.mockResolvedValue('segment text')
    const headers = new Headers({
      'content-type': 'audio/webm',
      'x-audio-meta': JSON.stringify({ language: 'en', segment: 7 }),
    })
    const body = new Blob([new Uint8Array(STT_SEGMENT_MAX_AUDIO_BYTES)], { type: 'audio/webm' })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: { headers, arrayBuffer: async () => body.arrayBuffer() },
    } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ transcript: 'segment text', segment: 7 })
  })

  it('AC-8: each segment request makes exactly one transcribeAudio (usage-logged) call', async () => {
    transcribeAudioMock.mockResolvedValue('x')
    for (let i = 0; i < 3; i++) {
      await POST({
        locals: { user: { id: 'u1' } },
        request: multipartRequest({ audio: makeChunkFile(12) }),
      } as never)
    }
    expect(transcribeAudioMock).toHaveBeenCalledTimes(3)
  })

  it('returns 402 with the billing message when credits run out', async () => {
    transcribeAudioMock.mockRejectedValue(
      Object.assign(new Error('Insufficient credits'), { name: 'InsufficientCreditsError' }),
    )
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: multipartRequest({ audio: makeChunkFile(12) }),
    } as never)
    expect(res.status).toBe(402)
    expect(((await res.json()) as { error: string }).error).toBe('Insufficient credits')
  })

  it('returns partial transcript on success', async () => {
    transcribeAudioMock.mockResolvedValue('hello there')
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: multipartRequest({ audio: makeChunkFile(12), language: 'en' }),
    } as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { transcript: string }
    expect(body.transcript).toBe('hello there')
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      userId: 'u1',
      audio: { bytes: expect.any(Uint8Array), format: 'webm' },
    })
  })

  it('returns error when chunk transcription fails', async () => {
    transcribeAudioMock.mockRejectedValue(new Error('LLM STT HTTP 502'))
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: multipartRequest({ audio: makeChunkFile(12) }),
    } as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('502')
  })
})
