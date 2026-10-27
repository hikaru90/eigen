import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractTemporalMentions } from './temporal-extraction'
import { TEMPORAL_ELEMENT_CONTRACT } from './temporal-normalize'

const { llmChatCompletionMock, evictMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
  evictMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))
vi.mock('$lib/server/llm/eval-llm-cache', () => ({
  evictEvalLlmCacheEntry: evictMock,
}))

function llmContent(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('extractTemporalMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed mentions from a { mentions: [...] } object response', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent(
        `{"mentions":[{"surface":"due Friday","kind":"deadline","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Report due Friday"}]}`,
      ),
    )

    const mentions = await extractTemporalMentions({
      userId: 'u1',
      normalizedText: 'Report due Friday',
      capturedAt: new Date('2026-05-20T12:00:00.000Z'),
      timezone: 'UTC',
    })

    expect(mentions).toHaveLength(1)
    expect(mentions[0]?.kind).toBe('deadline')
    expect(llmChatCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        temperature: 0,
      }),
    )
  })

  it('requests JSON object mode and asks for a JSON object with a "mentions" array', async () => {
    llmChatCompletionMock.mockResolvedValue(llmContent('{"mentions":[]}'))

    await extractTemporalMentions({
      userId: 'u1',
      normalizedText: 'can you help me with this?',
      capturedAt: new Date('2026-05-20T12:00:00.000Z'),
      timezone: 'UTC',
    })

    const call = llmChatCompletionMock.mock.calls[0]?.[0]
    expect(call.responseFormat).toBe('json_object')
    const prompt = call.messages[0].content as string
    expect(prompt).toContain('Return ONLY a JSON object')
    expect(prompt).toContain('"mentions"')
    expect(prompt).not.toContain('Return ONLY a JSON array')
    expect(prompt).not.toContain('return []')
  })

  it('returns no mentions for { mentions: [] }', async () => {
    llmChatCompletionMock.mockResolvedValue(llmContent('{"mentions":[]}'))
    await expect(
      extractTemporalMentions({
        userId: 'u1',
        normalizedText: 'nothing dated here',
        capturedAt: new Date('2026-05-20T12:00:00.000Z'),
        timezone: 'UTC',
      }),
    ).resolves.toEqual([])
  })

  it('accepts a fenced object response', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent(
        '```json\n{"mentions":[{"surface":"next Wednesday","kind":"appointment","startAt":"2026-05-27T15:00:00.000Z","timePrecision":"exact","timezone":"UTC","isAllDay":false,"confidence":0.8,"semanticSummary":"Dentist appointment"}]}\n```',
      ),
    )

    const mentions = await extractTemporalMentions({
      userId: 'u1',
      normalizedText: 'Dentist next Wednesday at 3pm',
      capturedAt: new Date('2026-05-20T12:00:00.000Z'),
      timezone: 'UTC',
    })

    expect(mentions).toHaveLength(1)
    expect(mentions[0]?.kind).toBe('appointment')
  })

  const input = {
    userId: 'u1',
    normalizedText: 'can you help me with this?',
    capturedAt: new Date('2026-05-20T12:00:00.000Z'),
    timezone: 'UTC',
  }

  it.each([
    ['prose', 'Please paste the text you want me to look at.'],
    ['a bare array (the old contract)', '[]'],
    ['an object without a mentions array', '{"events":[]}'],
    ['an object whose mentions is not an array', '{"mentions":"none"}'],
  ])(
    'fails loud on %s and evicts the cached response so a retry asks the model again',
    async (_label, content) => {
      const response = llmContent(content)
      llmChatCompletionMock.mockResolvedValue(response)

      await expect(extractTemporalMentions(input)).rejects.toThrow()

      expect(evictMock).toHaveBeenCalledTimes(1)
      expect(evictMock).toHaveBeenCalledWith(response)
    },
  )

  it('a clock-time reply with an off-catalog timePrecision fails loud, names the field, and is evicted', async () => {
    // The dentist reply: right date, precision "hour". It used to be dropped, so the date was lost.
    const response = llmContent(
      '{"mentions":[{"surface":"Friday at 9am","kind":"appointment","startAt":"2026-10-30T09:00:00+01:00","timePrecision":"hour","timezone":"Europe/Berlin","isAllDay":false,"confidence":0.9,"semanticSummary":"Dentist"}]}',
    )
    llmChatCompletionMock.mockResolvedValue(response)

    await expect(extractTemporalMentions(input)).rejects.toThrow(/timePrecision.*"hour"/)

    expect(evictMock).toHaveBeenCalledTimes(1)
    expect(evictMock).toHaveBeenCalledWith(response)
  })

  it('does not evict a response it could parse', async () => {
    llmChatCompletionMock.mockResolvedValue(llmContent('{"mentions":[]}'))
    await extractTemporalMentions(input)
    expect(evictMock).not.toHaveBeenCalled()
  })

  it('throws when the LLM response has no choices', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [] })

    await expect(
      extractTemporalMentions({
        userId: 'u1',
        normalizedText: 'no dates here',
        capturedAt: new Date('2026-05-20T12:00:00.000Z'),
        timezone: 'UTC',
      }),
    ).rejects.toThrow(/no choices/)
  })

  it('the prompt carries the shared temporal element contract with the allowed values', async () => {
    llmChatCompletionMock.mockResolvedValue(llmContent('{"mentions":[]}'))

    await extractTemporalMentions(input)

    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(prompt).toContain(TEMPORAL_ELEMENT_CONTRACT)
    expect(prompt).toContain(
      '"kind": "deadline|appointment|milestone|period|reminder|inferred_event"',
    )
    expect(prompt).toContain('"timePrecision": "exact|day|week|month|fuzzy"')
  })

  it('prompt prefers acquisition milestone over pre-order for devices', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent(
        `{"mentions":[{"surface":"pre-ordered the laptop on January 28th","kind":"milestone","startAt":"2023-01-28T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Dell XPS 13 laptop arrived on February 25th","relativeSpec":{"dateAnchor":"explicit","calendarDate":"2023-02-25"}}]}`,
      ),
    )

    await extractTemporalMentions({
      userId: 'u1',
      normalizedText:
        'I pre-ordered the laptop on January 28th, and it finally arrived on February 25th after a delay',
      capturedAt: new Date('2023-03-15T10:31:00.000Z'),
      timezone: 'UTC',
    })

    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(prompt).toContain('possession/acquisition milestone')
    expect(prompt).toContain('Do not emit a separate pre-order milestone')
  })

  it('prompt covers book completion, malfunctions, lodging, and seed-start dates', async () => {
    llmChatCompletionMock.mockResolvedValue(llmContent('{"mentions":[]}'))

    await extractTemporalMentions({
      userId: 'u1',
      normalizedText: 'placeholder',
      capturedAt: new Date('2023-05-27T12:00:00.000Z'),
      timezone: 'UTC',
    })

    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(prompt).toContain('finished X two weeks ago')
    expect(prompt).toContain('malfunctions and repairs')
    expect(prompt).toContain('booking/reservation date')
    expect(prompt).toContain('started X since DATE')
  })
})
