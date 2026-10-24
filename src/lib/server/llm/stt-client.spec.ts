import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseSttTranscript, transcribeAudio, STT_MODEL_OPENROUTER_DEFAULT } from './stt-client'

const { llmCreateTranscriptionMock } = vi.hoisted(() => ({
  llmCreateTranscriptionMock: vi.fn(),
}))

vi.mock('./llm-client', () => ({
  llmCreateTranscription: llmCreateTranscriptionMock,
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: {},
}))

describe('STT model', () => {
  it('is Qwen3 ASR 1.7B: verbatim transcription with no translate task, so speech is never auto-translated', () => {
    // whisper-large-v3 auto-translated speech instead of transcribing verbatim (2026-10-24);
    // its translate task is the failure mode — Qwen3-ASR is ASR + language-ID only.
    // qwen3-asr-0.6b before that hallucinated ("Ahora.", Chinese) on quiet segments.
    expect(STT_MODEL_OPENROUTER_DEFAULT).toBe('qwen/qwen3-asr-1.7b')
  })
})

describe('parseSttTranscript', () => {
  it('extracts trimmed text from dedicated STT body', () => {
    expect(parseSttTranscript({ text: '  hello  ' })).toBe('hello')
  })

  it('rejects chat completion body so assistant replies are not treated as transcripts', () => {
    expect(() =>
      parseSttTranscript({ choices: [{ message: { content: '  spoken words  ' } }] }),
    ).toThrow(/chat completion shape/)
  })

  it('throws when text missing', () => {
    expect(() => parseSttTranscript({})).toThrow(/missing transcript/)
  })

  it('a silent segment is an empty transcript, not an error (Whisper returns text: "")', () => {
    expect(parseSttTranscript({ text: '' })).toBe('')
    expect(parseSttTranscript({ text: '  ' })).toBe('')
  })
})

describe('transcribeAudio', () => {
  beforeEach(() => {
    llmCreateTranscriptionMock.mockReset()
  })

  it('calls gateway with default OpenRouter STT model', async () => {
    llmCreateTranscriptionMock.mockResolvedValue({ text: 'typed speech' })
    const out = await transcribeAudio({
      userId: 'u1',
      audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' },
    })
    expect(out).toBe('typed speech')
    expect(llmCreateTranscriptionMock).toHaveBeenCalledWith({
      userId: 'u1',
      model: STT_MODEL_OPENROUTER_DEFAULT,
      audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' },
    })
  })
})
