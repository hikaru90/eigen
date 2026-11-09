import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTranscriptCheckState,
  judgeTranscript,
  STT_JUDGE_ATTEMPTS,
  TRANSCRIPT_CHECK_CRITERIA,
} from './stt-judge'

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }))

vi.mock('$lib/server/db', () => ({ getDb: vi.fn() }))

vi.mock('./decision-plane', () => ({
  runEnforcedBoundedDecisions: runMock,
}))

function verdict(choice: string) {
  return new Map([
    [
      'transcript',
      { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 },
    ],
  ])
}

const languages = { writing: 'de', ui: 'en' }

describe('buildTranscriptCheckState', () => {
  it('carries the transcript and the user\'s known languages', () => {
    const state = buildTranscriptCheckState({ transcript: 'Guten Morgen', languages })
    expect(state).toContain('Guten Morgen')
    expect(state).toContain('de')
    expect(state).toContain('en')
  })

  it('says so when no language is on record instead of inventing one', () => {
    const state = buildTranscriptCheckState({
      transcript: 'hello',
      languages: { writing: null, ui: null },
    })
    expect(state).toMatch(/no language/i)
  })
})

describe('judgeTranscript (Layer 2: LLM judge, no string rules)', () => {
  beforeEach(() => {
    runMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('asks ONE enforced bounded Decisions question on the transcribe surface', async () => {
    runMock.mockResolvedValue(verdict('dictation'))
    await judgeTranscript({ userId: 'u1', transcript: 'Ich muss Milch kaufen', languages })
    expect(runMock).toHaveBeenCalledTimes(1)
    const call = runMock.mock.calls[0]![0]
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('transcribe')
    expect(call.state).toContain('Ich muss Milch kaufen')
    expect(call.specs).toHaveLength(1)
    expect(call.specs[0]).toMatchObject({
      decisionKind: 'transcript_check',
      id: 'transcript',
      llmChoice: null,
    })
    expect(Object.keys(call.specs[0].question.criteria)).toEqual(
      Object.keys(TRANSCRIPT_CHECK_CRITERIA),
    )
  })

  it('a real-dictation verdict returns dictation', async () => {
    runMock.mockResolvedValue(verdict('dictation'))
    expect(await judgeTranscript({ userId: 'u1', transcript: 'x', languages })).toBe('dictation')
  })

  it('an artefact verdict returns artefact', async () => {
    runMock.mockResolvedValue(verdict('artefact'))
    expect(await judgeTranscript({ userId: 'u1', transcript: '시청해 주셔서 감사합니다', languages })).toBe(
      'artefact',
    )
  })

  it('tells the judge a user who dictates in Korean, Chinese or Japanese is real dictation', async () => {
    runMock.mockResolvedValue(verdict('dictation'))
    await judgeTranscript({ userId: 'u1', transcript: 'x', languages: { writing: 'ko', ui: 'en' } })
    const { question, } = runMock.mock.calls[0]![0].specs[0]
    const text = `${question.instructions} ${Object.values(question.criteria).join(' ')}`
    expect(text).toMatch(/Korean/)
    expect(text).toMatch(/Chinese/)
    expect(text).toMatch(/Japanese/)
    expect(runMock.mock.calls[0]![0].state).toContain('ko')
  })

  it('retries a failed judge call up to exactly 3 attempts, then throws (no silent pass)', async () => {
    runMock.mockRejectedValue(new Error('decision call failed'))
    await expect(judgeTranscript({ userId: 'u1', transcript: 'x', languages })).rejects.toThrow(
      /decision call failed/,
    )
    expect(STT_JUDGE_ATTEMPTS).toBe(3)
    expect(runMock).toHaveBeenCalledTimes(3)
  })

  it('succeeds when a later attempt works', async () => {
    runMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(verdict('artefact'))
    expect(await judgeTranscript({ userId: 'u1', transcript: 'x', languages })).toBe('artefact')
    expect(runMock).toHaveBeenCalledTimes(2)
  })

  it('a missing or off-catalog answer is a failure, never a pass', async () => {
    runMock.mockResolvedValue(new Map())
    await expect(judgeTranscript({ userId: 'u1', transcript: 'x', languages })).rejects.toThrow()
    runMock.mockResolvedValue(verdict('maybe'))
    await expect(judgeTranscript({ userId: 'u1', transcript: 'x', languages })).rejects.toThrow()
  })

  it('never logs the transcript', async () => {
    const log = vi.spyOn(console, 'error')
    runMock.mockRejectedValue(new Error('decision call failed'))
    await expect(
      judgeTranscript({ userId: 'u1', transcript: 'SECRET-WORDS', languages }),
    ).rejects.toThrow()
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-WORDS')
  })
})
