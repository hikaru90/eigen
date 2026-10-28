import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSttTranscript, STT_MODEL, transcribeAudio } from './stt-client'

const { llmCreateTranscriptionMock } = vi.hoisted(() => ({
  llmCreateTranscriptionMock: vi.fn(),
}))

vi.mock('./llm-client', () => ({
  llmCreateTranscription: llmCreateTranscriptionMock,
}))

// the retired LLM_MODEL_STT override is set here on purpose: nothing may read it
vi.mock('$lib/server/env/private-env', () => ({
  env: { LLM_MODEL_STT: 'some/other-model' },
}))

describe('STT model', () => {
  it('is Qwen3 ASR 1.7B: verbatim transcription with no translate task, so speech is never auto-translated', () => {
    // whisper-large-v3 auto-translated speech instead of transcribing verbatim (2026-10-24);
    // its translate task is the failure mode — Qwen3-ASR is ASR + language-ID only.
    expect(STT_MODEL).toBe('qwen/qwen3-asr-0.6b')
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

  it('a clip without speech is an empty transcript, not an error (the model returns text: "")', () => {
    expect(parseSttTranscript({ text: '' })).toBe('')
    expect(parseSttTranscript({ text: '  ' })).toBe('')
  })
})

describe('transcribeAudio', () => {
  beforeEach(() => {
    llmCreateTranscriptionMock.mockReset()
  })

  it('makes one gateway call with the fixed model, whatever the environment says (VM-9)', async () => {
    llmCreateTranscriptionMock.mockResolvedValue({ text: 'typed speech' })
    const out = await transcribeAudio({
      userId: 'u1',
      audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' },
    })
    expect(out).toBe('typed speech')
    expect(llmCreateTranscriptionMock).toHaveBeenCalledTimes(1)
    expect(llmCreateTranscriptionMock).toHaveBeenCalledWith({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' },
    })
  })
})
