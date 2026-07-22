import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'
import { STT_MAX_AUDIO_BYTES } from '$lib/server/llm/stt-audio'

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

  it('rejects oversized chunk', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: multipartRequest({ audio: makeChunkFile(STT_MAX_AUDIO_BYTES + 1) }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
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
      audio: expect.objectContaining({ format: 'webm', language: 'en' }),
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
