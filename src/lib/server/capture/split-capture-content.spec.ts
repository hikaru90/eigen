import { describe, expect, it, vi, beforeEach } from 'vitest'
import { normalizedThoughtFromSplit, resolveCaptureContentSplit } from './split-capture-content'

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

describe('resolveCaptureContentSplit', () => {
  beforeEach(() => {
    llmChatCompletionMock.mockReset()
  })

  it('returns thought_only when LLM says entire input is the thought', async () => {
    mockLlmJson({
      mode: 'thought_only',
      thoughtText: 'Call Jonas about the contract',
      rationale: 'Short actionable note.',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'Call Jonas about the contract',
    })

    expect(result.mode).toBe('thought_only')
    expect(result.thoughtText).toBe('Call Jonas about the contract')
    expect(result.attachmentBody).toBe('')
  })

  it('forces thought_only thoughtText to verbatim capture when LLM paraphrases', async () => {
    const original =
      "When I open a project in the project pane and I click on the checkbox, the task on the project view doesn't get marked as done."
    mockLlmJson({
      mode: 'thought_only',
      thoughtText: 'Task can be marked as done',
      rationale: 'STT cleanup.',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: original,
    })

    expect(result.mode).toBe('thought_only')
    expect(result.thoughtText).toBe(original)
  })

  it('returns split with attachment when LLM partitions input', async () => {
    mockLlmJson({
      mode: 'split',
      thoughtText: 'Follow up on Q3 budget with finance',
      attachmentTitle: 'Meeting transcript',
      attachmentBody: 'Long transcript text here…',
      rationale: 'Summary line plus transcript.',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'Follow up on Q3 budget with finance\n\nLong transcript text here…',
    })

    expect(result.mode).toBe('split')
    expect(result.attachmentBody).toContain('transcript')
  })

  it('returns split for reference documents like recipes even when moderate length', async () => {
    mockLlmJson({
      mode: 'split',
      thoughtText: 'Pasta carbonara recipe from Nonna',
      attachmentTitle: 'Carbonara recipe',
      attachmentBody: 'Ingredients: spaghetti, guanciale, eggs…\n1. Boil pasta…',
      rationale: 'Recipe is reusable reference material, not a fleeting note.',
    })

    const result = await resolveCaptureContentSplit({
      userId: 'u1',
      rawText: 'Pasta carbonara recipe from Nonna\n\nIngredients: spaghetti…',
    })

    expect(result.mode).toBe('split')
    expect(result.thoughtText).toContain('carbonara')
    expect(result.attachmentBody).toContain('Ingredients')
  })

  it('retries once on invalid mode', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ mode: 'both', thoughtText: 'x' }) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                mode: 'thought_only',
                thoughtText: 'x',
                rationale: 'ok',
              }),
            },
          },
        ],
      })

    const result = await resolveCaptureContentSplit({ userId: 'u1', rawText: 'x' })
    expect(result.mode).toBe('thought_only')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
  })

  it('normalizes thought text deterministically', () => {
    expect(normalizedThoughtFromSplit('  hello   world  ')).toBe('hello world')
  })
})
