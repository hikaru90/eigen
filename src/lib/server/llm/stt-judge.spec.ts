import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTranscriptCheckState,
  judgeTranscript,
  loadUserWritingSamples,
  STT_JUDGE_ATTEMPTS,
  TRANSCRIPT_CHECK_CRITERIA,
  TRANSCRIPT_CHECK_INSTRUCTIONS,
  WRITING_SAMPLE_LIMIT,
  WRITING_SAMPLE_MAX_CHARS,
} from './stt-judge'

const { runMock, listThoughtsMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  listThoughtsMock: vi.fn(),
}))

vi.mock('$lib/server/capture/service', () => ({ listThoughts: listThoughtsMock }))

vi.mock('./decision-plane', () => ({
  runEnforcedBoundedDecisions: runMock,
}))

function verdict(choice: string) {
  return new Map([
    ['transcript', { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 }],
  ])
}

const writingSamples = ['Morgen Zahnarzt anrufen', 'ship the release notes']

describe('buildTranscriptCheckState', () => {
  it('lists each writing sample as a line, then the transcript', () => {
    const state = buildTranscriptCheckState({ transcript: 'Guten Morgen', writingSamples })
    expect(state).toBe(
      'Recent writing by this user (samples):\n- Morgen Zahnarzt anrufen\n- ship the release notes\n\nTranscript to judge:\nGuten Morgen',
    )
  })

  it('says exactly that no writing is on record when there are no samples', () => {
    const state = buildTranscriptCheckState({ transcript: 'hello', writingSamples: [] })
    expect(state).toBe('No writing by this user is on record yet.\n\nTranscript to judge:\nhello')
  })

  it('never carries language settings', () => {
    const state = buildTranscriptCheckState({ transcript: 'hello', writingSamples })
    expect(state).not.toMatch(/settings|interface language|preferred|locale/i)
  })
})

describe('loadUserWritingSamples', () => {
  beforeEach(() => listThoughtsMock.mockReset())

  it('reads the last 6 user-authored thoughts as snippets', async () => {
    listThoughtsMock.mockResolvedValue([])
    await loadUserWritingSamples('u1')
    expect(WRITING_SAMPLE_LIMIT).toBe(6)
    expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
      fields: 'snippet',
      limit: 6,
      authorFilter: 'user',
    })
  })

  it('trims, drops empty rows and cuts each sample to 160 characters', async () => {
    listThoughtsMock.mockResolvedValue([
      { normalizedText: '  Hallo Welt  ' },
      { normalizedText: '   ' },
      { normalizedText: null },
      { normalizedText: 'x'.repeat(200) },
    ])
    const samples = await loadUserWritingSamples('u1')
    expect(WRITING_SAMPLE_MAX_CHARS).toBe(160)
    expect(samples).toEqual(['Hallo Welt', 'x'.repeat(160)])
  })
})

describe('transcript_check wording', () => {
  it('instructions and criteria are the validated wording', () => {
    expect(TRANSCRIPT_CHECK_INSTRUCTIONS).toBe(
      "A speech recognition model transcribed a voice message from this user. Is the text plausibly real dictation by this user, or an artefact of recognition on silence or noise? When samples of the user's own recent writing are shown, they show which languages this user uses; they are a sample, not a complete list, and their content is not what is judged.",
    )
    expect(TRANSCRIPT_CHECK_CRITERIA).toEqual({
      dictation:
        "The text is plausibly what this user really said: a coherent utterance, also short, informal, mixed-language or unfinished speech, in a language that fits the user's own writing, or in any language when none of their writing is shown.",
      artefact:
        "The text is more likely an artefact of speech recognition on silence or noise: repeated syllables or words with no content, a stock subtitle or credit phrase (thanks for watching, subtitles by ...), a stray filler word with no content, or a fragment in a language or script that none of the user's own writing uses.",
    })
  })
})

describe('judgeTranscript (Layer 2: LLM judge, no string rules)', () => {
  beforeEach(() => {
    runMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('asks ONE enforced bounded Decisions question on the transcribe surface', async () => {
    runMock.mockResolvedValue(verdict('dictation'))
    await judgeTranscript({ userId: 'u1', transcript: 'Ich muss Milch kaufen', writingSamples })
    expect(runMock).toHaveBeenCalledTimes(1)
    const call = runMock.mock.calls[0]![0]
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('transcribe')
    expect(call.state).toContain('Ich muss Milch kaufen')
    expect(call.state).toContain('- Morgen Zahnarzt anrufen')
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
    expect(await judgeTranscript({ userId: 'u1', transcript: 'x', writingSamples })).toBe(
      'dictation',
    )
  })

  it('an artefact verdict returns artefact', async () => {
    runMock.mockResolvedValue(verdict('artefact'))
    expect(
      await judgeTranscript({
        userId: 'u1',
        transcript: '시청해 주셔서 감사합니다',
        writingSamples,
      }),
    ).toBe('artefact')
  })

  it('retries a failed judge call up to exactly 3 attempts, then throws (no silent pass)', async () => {
    runMock.mockRejectedValue(new Error('decision call failed'))
    await expect(
      judgeTranscript({ userId: 'u1', transcript: 'x', writingSamples }),
    ).rejects.toThrow(/decision call failed/)
    expect(STT_JUDGE_ATTEMPTS).toBe(3)
    expect(runMock).toHaveBeenCalledTimes(3)
  })

  it('succeeds when a later attempt works', async () => {
    runMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(verdict('artefact'))
    expect(await judgeTranscript({ userId: 'u1', transcript: 'x', writingSamples })).toBe(
      'artefact',
    )
    expect(runMock).toHaveBeenCalledTimes(2)
  })

  it('a missing or off-catalog answer is a failure, never a pass', async () => {
    runMock.mockResolvedValue(new Map())
    await expect(
      judgeTranscript({ userId: 'u1', transcript: 'x', writingSamples }),
    ).rejects.toThrow()
    runMock.mockResolvedValue(verdict('maybe'))
    await expect(
      judgeTranscript({ userId: 'u1', transcript: 'x', writingSamples }),
    ).rejects.toThrow()
  })

  it('never logs the transcript', async () => {
    const log = vi.spyOn(console, 'error')
    runMock.mockRejectedValue(new Error('decision call failed'))
    await expect(
      judgeTranscript({ userId: 'u1', transcript: 'SECRET-WORDS', writingSamples }),
    ).rejects.toThrow()
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-WORDS')
  })
})
