import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractTemporalMentions } from './temporal-extraction'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function llmContent(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('extractTemporalMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed mentions from a JSON array response', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent(
        `[{"surface":"due Friday","kind":"deadline","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Report due Friday"}]`,
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

  it('unwraps { events: [...] } payloads from the model', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent(
        '```json\n{"events":[{"surface":"next Wednesday","kind":"appointment","startAt":"2026-05-27T15:00:00.000Z","timePrecision":"exact","timezone":"UTC","isAllDay":false,"confidence":0.8,"semanticSummary":"Dentist appointment"}]}\n```',
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

  it('prompt prefers acquisition milestone over pre-order for devices', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent(
        `[{"surface":"pre-ordered the laptop on January 28th","kind":"milestone","startAt":"2023-01-28T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Dell XPS 13 laptop arrived on February 25th","relativeSpec":{"dateAnchor":"explicit","calendarDate":"2023-02-25"}}]`,
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
    llmChatCompletionMock.mockResolvedValue(llmContent('[]'))

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
