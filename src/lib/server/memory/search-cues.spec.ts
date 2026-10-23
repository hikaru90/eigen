import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASK_QUESTION_RULE } from './ask-question'
import { extractRecallCues, MAX_CUES, parseSearchCues } from './search-cues'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function makeResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] }
}

describe('parseSearchCues', () => {
  it('keeps trimmed in-range strings only', () => {
    expect(
      parseSearchCues(['  buy oat milk ', 'x', 'a'.repeat(81), 42, null, 'valid cue phrase']),
    ).toEqual(['buy oat milk', 'valid cue phrase'])
  })

  it('caps at MAX_CUES', () => {
    const cues = Array.from({ length: MAX_CUES + 3 }, (_, i) => `cue phrase ${i}`)
    expect(parseSearchCues(cues)).toHaveLength(MAX_CUES)
  })

  it('returns [] for non-array input', () => {
    expect(parseSearchCues(undefined)).toEqual([])
    expect(parseSearchCues('cue')).toEqual([])
    expect(parseSearchCues(null)).toEqual([])
  })
})

describe('extractRecallCues (re-enrich after edit: cues + askQuestion in one call)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed cues and the question from the LLM JSON object', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse({
        cues: ['mcp bearer key', 'agent authorship'],
        askQuestion: ' How does the MCP key label authorship? ',
      }),
    )
    const recall = await extractRecallCues({
      userId: 'u1',
      normalizedText: 'MCP Bearer key auto-labels agent authorship',
    })
    expect(recall).toEqual({
      cues: ['mcp bearer key', 'agent authorship'],
      askQuestion: 'How does the MCP key label authorship?',
    })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(llmChatCompletionMock.mock.calls[0]?.[0]?.responseFormat).toBe('json_object')
  })

  it('never asks for any type label (single type axis)', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse({ cues: [], askQuestion: null }))
    await extractRecallCues({ userId: 'u1', normalizedText: 'text' })
    const messages = llmChatCompletionMock.mock.calls[0]?.[0]?.messages as Array<{
      content: string
    }>
    const prompt = messages.map((m) => m.content).join('\n')
    expect(prompt).not.toContain('memoryType')
    expect(prompt).not.toContain('category')
  })

  it('throws when the response has no choices', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [] })
    await expect(extractRecallCues({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow(
      /no choices/,
    )
  })

  it('asks for askQuestion with the shared SQ-2 rules', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse({ cues: [], askQuestion: null }))
    await extractRecallCues({ userId: 'u1', normalizedText: 'hi' })
    const prompt = (llmChatCompletionMock.mock.calls[0]?.[0]?.messages as Array<{ content: string }>)
      .map((m) => m.content)
      .join('\n')
    expect(prompt).toContain('"askQuestion"')
    expect(prompt).toContain(ASK_QUESTION_RULE)
  })

  it('rejects a response without the askQuestion key (contract violation, no default)', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse({ cues: ['some cue here'] }))
    await expect(extractRecallCues({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow(
      /askQuestion/,
    )
  })
})
