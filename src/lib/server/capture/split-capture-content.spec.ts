import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_SECRETS, guardWouldTrip, leaks } from '$lib/test/secret-fixtures'
import { SPLIT_FANOUT_MAX } from './content-role'
import * as splitModule from './split-capture-content'
import {
  normalizedThoughtFromSplit,
  resolveCaptureContentSplit,
  validateVerbatimSpans,
} from './split-capture-content'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function mockLlmJson(body: Record<string, unknown>) {
  llmChatCompletionMock.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(body) } }],
  })
}

function llmReply(body: Record<string, unknown>) {
  return { choices: [{ message: { content: JSON.stringify(body) } }] }
}

// A ~900-char journal entry about three distinct things.
const TOPIC_WORK =
  'Work was a grind today: the quarterly planning meeting ran two hours over, Jonas pushed back on the roadmap again, and I still have not heard back from finance about the budget for the Lisbon offsite next month. I stayed late to rewrite the slides and left feeling drained. Tomorrow starts with another early call with the Berlin team.'
const TOPIC_BODY =
  'My knee has been aching since the hike on Sunday, so I booked a physiotherapy appointment for Thursday morning. The doctor on the phone said to keep ice on it and skip running until then, which is annoying because I was just getting back into a routine.'
const TOPIC_FAMILY =
  'Mom called in the evening about her seventieth birthday in March. She wants a small dinner at home, nothing fancy, and asked me to bring the lemon cake. I promised I would book the train tickets this weekend and ask my sister whether she can come too. We also talked about the garden for a while, and she wants me to take cuttings of the old rose before winter.'
const JOURNAL = `${TOPIC_WORK}\n\n${TOPIC_BODY}\n\n${TOPIC_FAMILY}`

describe('forced split is gone', () => {
  it('no longer exports the 500-char rule', () => {
    expect(splitModule).not.toHaveProperty('LONG_CAPTURE_MIN_CHARS')
    expect(splitModule).not.toHaveProperty('captureSplitMode')
  })

  it('a ~900-char personal entry is never turned into a pointer + note by length', async () => {
    expect(JOURNAL.length).toBeGreaterThanOrEqual(900)
    mockLlmJson({ role: 'personal', spans: [JOURNAL], rationale: 'one continuous account' })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: JOURNAL,
      decidedRole: 'personal',
    })

    expect(result).toMatchObject({ role: 'personal', spans: [JOURNAL] })
    expect(result).not.toHaveProperty('attachmentBody')
  })
})

describe('resolveCaptureContentSplit', () => {
  beforeEach(() => {
    llmChatCompletionMock.mockReset()
  })

  it('personal: a short entry is one span holding the whole message', async () => {
    mockLlmJson({
      role: 'personal',
      spans: ['Call Jonas about the contract'],
      rationale: 'Short actionable note.',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'Call Jonas about the contract',
    })

    expect(result).toEqual({
      role: 'personal',
      spans: ['Call Jonas about the contract'],
      rationale: 'Short actionable note.',
    })
  })

  it('personal: a three-topic journal entry becomes three verbatim spans in text order', async () => {
    mockLlmJson({
      role: 'personal',
      spans: [TOPIC_WORK, TOPIC_BODY, TOPIC_FAMILY],
      rationale: 'three distinct things',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: JOURNAL,
      decidedRole: 'personal',
    })

    if (result.role !== 'personal') throw new Error('expected personal')
    expect(result.spans).toEqual([TOPIC_WORK, TOPIC_BODY, TOPIC_FAMILY])
    for (const span of result.spans) expect(JOURNAL).toContain(span)
  })

  it('personal: surrounding whitespace on a span is trimmed (validation only), the words are not touched', async () => {
    mockLlmJson({
      role: 'personal',
      spans: [`  ${TOPIC_WORK}\n`, `\n${TOPIC_BODY}  `, TOPIC_FAMILY],
      rationale: 'r',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: JOURNAL,
      decidedRole: 'personal',
    })

    if (result.role !== 'personal') throw new Error('expected personal')
    expect(result.spans).toEqual([TOPIC_WORK, TOPIC_BODY, TOPIC_FAMILY])
  })

  it('reference: pointer thought plus the full body as a note', async () => {
    mockLlmJson({
      role: 'reference',
      thoughtText: 'Pasta carbonara recipe from Nonna',
      attachmentTitle: 'Carbonara recipe',
      attachmentBody: 'Ingredients: spaghetti, guanciale, eggs…\n1. Boil pasta…',
      rationale: 'Recipe is reusable reference material.',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'Pasta carbonara recipe from Nonna\n\nIngredients: spaghetti…',
    })

    expect(result).toMatchObject({
      role: 'reference',
      thoughtText: 'Pasta carbonara recipe from Nonna',
      attachmentTitle: 'Carbonara recipe',
    })
    expect(result).not.toHaveProperty('spans')
  })

  it('mixed: the personal span is verbatim and the reference part is the note body', async () => {
    const raw = "I'm baking this for Mom's 70th, she can't have nuts:\n\nIngredients: flour, butter, eggs…"
    mockLlmJson({
      role: 'mixed',
      spans: ["I'm baking this for Mom's 70th, she can't have nuts:"],
      attachmentTitle: 'Birthday cake recipe',
      attachmentBody: 'Ingredients: flour, butter, eggs…',
      rationale: 'personal intent plus a pasted recipe',
    })

    const result = await resolveCaptureContentSplit({ userId: 'u1', rawText: raw, decidedRole: 'mixed' })

    expect(result).toEqual({
      role: 'mixed',
      spans: ["I'm baking this for Mom's 70th, she can't have nuts:"],
      attachmentTitle: 'Birthday cake recipe',
      attachmentBody: 'Ingredients: flour, butter, eggs…',
      rationale: 'personal intent plus a pasted recipe',
    })
  })

  it('a decided role always wins over the role the LLM labels', async () => {
    mockLlmJson({
      role: 'reference',
      spans: ['The original capture'],
      thoughtText: 'x',
      attachmentBody: 'y',
      rationale: 'labelled differently',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'The original capture',
      decidedRole: 'personal',
    })

    expect(result.role).toBe('personal')
  })

  it('tells the LLM the role is already decided (generation only)', async () => {
    mockLlmJson({ role: 'personal', spans: ['raw capture'], rationale: 'r' })
    await resolveCaptureContentSplit({ userId: 'u1', rawText: 'raw capture', decidedRole: 'personal' })
    const prompt = llmChatCompletionMock.mock.calls[0][0].messages[1].content as string
    expect(prompt).toContain('ALREADY DECIDED')
    expect(prompt).toContain('"personal"')
  })

  it('asks for exact substrings and forbids rewriting', async () => {
    mockLlmJson({ role: 'personal', spans: ['raw capture'], rationale: 'r' })
    await resolveCaptureContentSplit({ userId: 'u1', rawText: 'raw capture', decidedRole: 'personal' })
    const prompt = llmChatCompletionMock.mock.calls[0][0].messages[1].content as string
    expect(prompt).toMatch(/character for character/)
    expect(prompt).toMatch(/never rewrite/i)
  })

  describe('invalid answers fail loud (one strict retry, then throw)', () => {
    beforeEach(() => llmChatCompletionMock.mockReset())

    it('a role outside the three', async () => {
      llmChatCompletionMock.mockResolvedValue(llmReply({ role: 'thought_only', spans: ['x'] }))

      await expect(resolveCaptureContentSplit({ userId: 'u1', rawText: 'x' })).rejects.toThrow(
        /invalid role "thought_only"/,
      )
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    })

    it('recovers when the strict retry returns a valid answer', async () => {
      llmChatCompletionMock
        .mockResolvedValueOnce(llmReply({ role: 'both', spans: ['x'] }))
        .mockResolvedValueOnce(llmReply({ role: 'personal', spans: ['x'], rationale: 'ok' }))

      const result = await resolveCaptureContentSplit({ userId: 'u1', rawText: 'x' })
      expect(result.role).toBe('personal')
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
      const retryPrompt = llmChatCompletionMock.mock.calls[1][0].messages[1].content as string
      expect(retryPrompt).toContain('invalid role "both"')
    })

    it('a span that is not a verbatim substring of the capture', async () => {
      llmChatCompletionMock.mockResolvedValue(
        llmReply({ role: 'personal', spans: ['Mom called about her 70th birthday'], rationale: 'r' }),
      )

      await expect(
        resolveCaptureContentSplit({
          userId: 'u1',
          rawText: 'Mom called in the evening about her seventieth birthday',
          decidedRole: 'personal',
        }),
      ).rejects.toThrow(/not a verbatim substring/)
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    })

    it('overlapping spans', async () => {
      llmChatCompletionMock.mockResolvedValue(
        llmReply({ role: 'personal', spans: ['Knee hurts. Booked physio.', 'Booked physio. Mom called.'], rationale: 'r' }),
      )

      await expect(
        resolveCaptureContentSplit({
          userId: 'u1',
          rawText: 'Knee hurts. Booked physio. Mom called.',
          decidedRole: 'personal',
        }),
      ).rejects.toThrow(/overlaps an earlier span or is out of order/)
    })

    it('personal spans must cover the whole capture — dropped text is a failure, not a silent loss', async () => {
      llmChatCompletionMock.mockResolvedValue(
        llmReply({ role: 'personal', spans: ['Knee hurts.'], rationale: 'r' }),
      )

      await expect(
        resolveCaptureContentSplit({
          userId: 'u1',
          rawText: 'Knee hurts. Booked physio.',
          decidedRole: 'personal',
        }),
      ).rejects.toThrow(/not covered/)
    })

    it('personal and mixed need at least one span', async () => {
      llmChatCompletionMock.mockResolvedValue(llmReply({ role: 'personal', spans: [], rationale: 'r' }))
      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: 'x', decidedRole: 'personal' }),
      ).rejects.toThrow(/at least one span/)

      llmChatCompletionMock.mockResolvedValue(
        llmReply({ role: 'mixed', spans: [], attachmentBody: 'body', rationale: 'r' }),
      )
      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: 'x body', decidedRole: 'mixed' }),
      ).rejects.toThrow(/at least one span/)
    })

    it(`more than ${SPLIT_FANOUT_MAX} spans is a contract violation, not a silent truncation`, async () => {
      const words = Array.from({ length: SPLIT_FANOUT_MAX + 1 }, (_, i) => `Thing${i + 1}.`)
      llmChatCompletionMock.mockResolvedValue(llmReply({ role: 'personal', spans: words, rationale: 'r' }))

      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: words.join(' '), decidedRole: 'personal' }),
      ).rejects.toThrow(new RegExp(String(SPLIT_FANOUT_MAX + 1)))
    })

    it('a non-string or blank span', async () => {
      llmChatCompletionMock.mockResolvedValue(llmReply({ role: 'personal', spans: ['x', '  '], rationale: 'r' }))
      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: 'x', decidedRole: 'personal' }),
      ).rejects.toThrow(/span 2/)
    })

    it('mixed without a reference body', async () => {
      llmChatCompletionMock.mockResolvedValue(llmReply({ role: 'mixed', spans: ['x'], rationale: 'r' }))
      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: 'x body', decidedRole: 'mixed' }),
      ).rejects.toThrow(/attachmentBody is required/)
    })

    it('reference without a body, or with a pointer identical to the body', async () => {
      llmChatCompletionMock.mockResolvedValue(llmReply({ role: 'reference', thoughtText: 'x', rationale: 'r' }))
      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: 'x', decidedRole: 'reference' }),
      ).rejects.toThrow(/attachmentBody is required/)

      llmChatCompletionMock.mockResolvedValue(
        llmReply({ role: 'reference', thoughtText: 'same', attachmentBody: 'same', rationale: 'r' }),
      )
      await expect(
        resolveCaptureContentSplit({ userId: 'u1', rawText: 'same', decidedRole: 'reference' }),
      ).rejects.toThrow(/must differ/)
    })
  })

  it('rejects an empty capture before any LLM call', async () => {
    await expect(resolveCaptureContentSplit({ userId: 'u1', rawText: '   ' })).rejects.toThrow(
      /rawText is required/,
    )
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('normalizes thought text deterministically', () => {
    expect(normalizedThoughtFromSplit('  hello   world  ')).toBe('hello world')
  })
})

describe('validateVerbatimSpans', () => {
  const raw = 'Alpha one. Beta two.\n\nGamma three.'

  it('locates spans in order and returns them trimmed', () => {
    expect(
      validateVerbatimSpans(raw, ['Alpha one.', ' Beta two.', 'Gamma three.'], { coverage: true }),
    ).toEqual(['Alpha one.', 'Beta two.', 'Gamma three.'])
  })

  it('the same words may appear twice when they occur twice in the text', () => {
    expect(validateVerbatimSpans('ok. ok.', ['ok.', 'ok.'], { coverage: true })).toEqual(['ok.', 'ok.'])
  })

  it('rejects spans that appear out of text order as overlapping/out of order', () => {
    expect(() => validateVerbatimSpans(raw, ['Gamma three.', 'Alpha one.'], { coverage: false })).toThrow(
      /out of order/,
    )
  })

  it('without coverage (mixed) text between spans may be left for the note', () => {
    expect(validateVerbatimSpans(raw, ['Alpha one.', 'Gamma three.'], { coverage: false })).toEqual([
      'Alpha one.',
      'Gamma three.',
    ])
  })

  it('with coverage (personal) any uncovered text between or after spans is rejected', () => {
    expect(() => validateVerbatimSpans(raw, ['Alpha one.', 'Gamma three.'], { coverage: true })).toThrow(
      /not covered/,
    )
    expect(() => validateVerbatimSpans(raw, ['Alpha one.'], { coverage: true })).toThrow(/not covered/)
  })

  it('rejects anything that is not an array', () => {
    expect(() => validateVerbatimSpans(raw, 'Alpha one.', { coverage: true })).toThrow(/array/)
  })
})

describe('resolveCaptureContentSplit secret hygiene (docs/planning/secret-hygiene.md)', () => {
  beforeEach(() => {
    llmChatCompletionMock.mockReset()
  })

  const withSecret = `Ship the deploy today. LLM_API_KEY=${FAKE_SECRETS.openai} Then call Mom about the dinner.`

  it('the generation prompt carries only the redacted capture', async () => {
    mockLlmJson({ role: 'personal', spans: ['placeholder'], rationale: 'x' })
    llmChatCompletionMock.mockResolvedValue(
      llmReply({
        role: 'personal',
        spans: [
          'Ship the deploy today. LLM_API_KEY=[redacted secret]',
          'Then call Mom about the dinner.',
        ],
        rationale: 'two things',
      }),
    )

    await resolveCaptureContentSplit({ userId: 'u1', rawText: withSecret, decidedRole: 'personal' })

    const messages = llmChatCompletionMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    const sent = JSON.stringify(messages)
    expect(leaks(sent)).toBe(false)
    expect(guardWouldTrip(messages)).toBe(false)
    expect(sent).toContain('LLM_API_KEY=[redacted secret]')
  })

  it('Phase-A spans are cut from the redacted text: they are verbatim substrings of it and hold no secret', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmReply({
        role: 'personal',
        spans: [
          'Ship the deploy today. LLM_API_KEY=[redacted secret]',
          'Then call Mom about the dinner.',
        ],
        rationale: 'two things',
      }),
    )

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: withSecret,
      decidedRole: 'personal',
    })

    expect(result.role).toBe('personal')
    if (result.role !== 'personal') return
    expect(result.spans).toEqual([
      'Ship the deploy today. LLM_API_KEY=[redacted secret]',
      'Then call Mom about the dinner.',
    ])
    expect(leaks(JSON.stringify(result))).toBe(false)
  })

  it('a span that tries to bring the secret back is not a substring of the redacted capture and fails loudly', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmReply({
        role: 'personal',
        spans: [`Ship the deploy today. LLM_API_KEY=${FAKE_SECRETS.openai}`, 'Then call Mom about the dinner.'],
        rationale: 'two things',
      }),
    )
    await expect(
      resolveCaptureContentSplit({ userId: 'u1', rawText: withSecret, decidedRole: 'personal' }),
    ).rejects.toThrow(/not a verbatim substring/)
  })

  it('a reference note body is cut from the redacted capture', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmReply({
        role: 'reference',
        thoughtText: 'Deploy runbook',
        attachmentTitle: 'Runbook',
        attachmentBody: 'Set LLM_API_KEY=[redacted secret] and run the deploy.',
        rationale: 'a runbook',
      }),
    )
    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: `Set LLM_API_KEY=${FAKE_SECRETS.openai} and run the deploy.`,
      decidedRole: 'reference',
    })
    expect(leaks(JSON.stringify(llmChatCompletionMock.mock.calls))).toBe(false)
    expect(leaks(JSON.stringify(result))).toBe(false)
  })
})

describe('resolveCaptureContentSplit note bodies that hold a secret placeholder (docs/planning/secret-hygiene.md, Part 2)', () => {
  beforeEach(() => {
    llmChatCompletionMock.mockReset()
  })

  const raw = `Set LLM_API_KEY=${FAKE_SECRETS.openai} and run the deploy. Token ${FAKE_SECRETS.githubClassic} is for CI.`
  const exact =
    'Set LLM_API_KEY=[redacted secret] and run the deploy. Token [redacted secret] is for CI.'

  const referenceReply = (attachmentBody: string) =>
    llmReply({
      role: 'reference',
      thoughtText: 'Deploy runbook',
      attachmentTitle: 'Runbook',
      attachmentBody,
      rationale: 'a runbook',
    })

  it('accepts a body copied exactly from the redacted capture (so it can be mapped back to the original)', async () => {
    llmChatCompletionMock.mockResolvedValue(referenceReply(exact))
    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: raw,
      decidedRole: 'reference',
    })
    expect(result).toMatchObject({ role: 'reference', attachmentBody: exact })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('a body with a placeholder that is not an exact copy gets the strict retry, then succeeds', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce(
        referenceReply('Set LLM_API_KEY=[redacted secret] then deploy (tidied by the model)'),
      )
      .mockResolvedValueOnce(referenceReply(exact))

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: raw,
      decidedRole: 'reference',
    })

    expect(result).toMatchObject({ attachmentBody: exact })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    const retryPrompt = JSON.stringify(llmChatCompletionMock.mock.calls[1]![0])
    expect(retryPrompt).toMatch(/not copied exactly from the message/)
    expect(leaks(JSON.stringify(llmChatCompletionMock.mock.calls))).toBe(false)
  })

  it('fails loud when the retry is no better', async () => {
    llmChatCompletionMock.mockResolvedValue(
      referenceReply('Deploy with [redacted secret] (paraphrased)'),
    )
    await expect(
      resolveCaptureContentSplit({ userId: 'u1', rawText: raw, decidedRole: 'reference' }),
    ).rejects.toThrow(/not copied exactly from the message/)
  })

  it('applies to the mixed note body as well', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmReply({
        role: 'mixed',
        spans: ['Set'],
        attachmentTitle: 'Runbook',
        attachmentBody: 'a paraphrase with [redacted secret]',
        rationale: 'r',
      }),
    )
    await expect(
      resolveCaptureContentSplit({ userId: 'u1', rawText: raw, decidedRole: 'mixed' }),
    ).rejects.toThrow(/not copied exactly from the message/)
  })

  it('a body without a placeholder keeps the old latitude (speech-to-text fixes allowed)', async () => {
    llmChatCompletionMock.mockResolvedValue(referenceReply('A tidied runbook with no credentials'))
    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'a runbook with no credentials at all',
      decidedRole: 'reference',
    })
    expect(result).toMatchObject({ attachmentBody: 'A tidied runbook with no credentials' })
  })

  it('tells the model to copy placeholder-bearing bodies exactly, only when the capture holds a placeholder', async () => {
    llmChatCompletionMock.mockResolvedValue(referenceReply(exact))
    await resolveCaptureContentSplit({ userId: 'u1', rawText: raw, decidedRole: 'reference' })
    expect(JSON.stringify(llmChatCompletionMock.mock.calls[0]![0])).toMatch(/copied exactly/)

    llmChatCompletionMock.mockClear()
    llmChatCompletionMock.mockResolvedValue(referenceReply('plain body'))
    await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'plain text here',
      decidedRole: 'reference',
    })
    expect(JSON.stringify(llmChatCompletionMock.mock.calls[0]![0])).not.toMatch(
      /\[redacted secret\]/,
    )
  })
})
