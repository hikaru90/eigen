import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STT_CLIP_MAX_AUDIO_BYTES } from '$lib/server/llm/stt-audio'
import { POST } from './+server'

const { transcribeAudioMock } = vi.hoisted(() => ({
  transcribeAudioMock: vi.fn(),
}))

vi.mock('$lib/server/llm/stt-client', () => ({
  transcribeAudio: transcribeAudioMock,
}))

function audioRequest(bytes: number, type = 'audio/webm') {
  const body = new Blob([new Uint8Array(bytes)], { type })
  return {
    headers: new Headers({ 'content-type': type || 'application/octet-stream' }),
    arrayBuffer: vi.fn(async () => body.arrayBuffer()),
  }
}

function call(request: unknown, user: { id: string } | null = { id: 'u1' }) {
  return POST({ locals: { user }, request } as never)
}

describe('POST /api/capture/transcribe', () => {
  beforeEach(() => {
    transcribeAudioMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('requires auth', async () => {
    await expect(call(audioRequest(12), null)).rejects.toMatchObject({ status: 401 })
    expect(transcribeAudioMock).not.toHaveBeenCalled()
  })

  it('transcribes the whole clip from a raw audio body (AC-2)', async () => {
    transcribeAudioMock.mockResolvedValue('hello there')
    const res = await call(audioRequest(12))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ transcript: 'hello there' })
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      userId: 'u1',
      audio: { bytes: expect.any(Uint8Array), format: 'webm' },
    })
  })

  it('maps a Safari clip (audio/mp4) to m4a', async () => {
    transcribeAudioMock.mockResolvedValue('x')
    await call(audioRequest(12, 'audio/mp4'))
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      userId: 'u1',
      audio: { bytes: expect.any(Uint8Array), format: 'm4a' },
    })
  })

  it('answers an empty transcript as "" (no speech), not an error', async () => {
    transcribeAudioMock.mockResolvedValue('')
    const res = await call(audioRequest(12))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ transcript: '' })
  })

  it('AC-9: one clip is one transcription call (the 3 provider attempts live in one layer below)', async () => {
    transcribeAudioMock.mockResolvedValue('x')
    await call(audioRequest(12))
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty body', async () => {
    await expect(call(audioRequest(0))).rejects.toMatchObject({ status: 400 })
    expect(transcribeAudioMock).not.toHaveBeenCalled()
  })

  it('rejects an unsupported audio type', async () => {
    await expect(call(audioRequest(12, 'audio/x-unknown'))).rejects.toMatchObject({ status: 400 })
    await expect(call(audioRequest(12, 'multipart/form-data; boundary=x'))).rejects.toMatchObject({
      status: 400,
    })
    expect(transcribeAudioMock).not.toHaveBeenCalled()
  })

  it('AC-10: an upload over the limit is a 400 that names the limit', async () => {
    await expect(call(audioRequest(STT_CLIP_MAX_AUDIO_BYTES + 1))).rejects.toMatchObject({
      status: 400,
      body: { message: expect.stringContaining(`${STT_CLIP_MAX_AUDIO_BYTES} bytes`) },
    })
    expect(transcribeAudioMock).not.toHaveBeenCalled()
  })

  it('accepts a clip at the limit', async () => {
    transcribeAudioMock.mockResolvedValue('long one')
    const res = await call(audioRequest(STT_CLIP_MAX_AUDIO_BYTES))
    expect(res.status).toBe(200)
  })

  it('AC-5: answers 402 with the billing message when credits run out', async () => {
    transcribeAudioMock.mockRejectedValue(
      Object.assign(new Error('Insufficient credits'), { name: 'InsufficientCreditsError' }),
    )
    const res = await call(audioRequest(12))
    expect(res.status).toBe(402)
    expect(((await res.json()) as { error: string }).error).toBe('Insufficient credits')
  })

  it('answers a failed transcription with a 5xx and a plain message, not the provider error', async () => {
    transcribeAudioMock.mockRejectedValue(new Error('LLM STT HTTP 502: {"error":"upstream gone"}'))
    const res = await call(audioRequest(12))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Transcription failed')
    expect(body.error).not.toContain('upstream')
  })

  it('logs the failure without any audio', async () => {
    transcribeAudioMock.mockRejectedValue(new Error('LLM STT HTTP 502'))
    await call(audioRequest(64))
    const logged = vi.mocked(console.error).mock.calls
    expect(logged.length).toBeGreaterThan(0)
    for (const args of logged) {
      for (const arg of args) {
        expect(arg).not.toBeInstanceOf(Uint8Array)
        expect(JSON.stringify(arg) ?? '').not.toMatch(/"bytes"|"audio"/)
      }
    }
  })
})
