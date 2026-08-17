import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractSearchCues, MAX_CUES, parseSearchCues } from './search-cues'

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

describe('extractSearchCues', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed cues from the LLM JSON object', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse({ cues: ['mcp bearer key', 'agent authorship'] }),
    )
    const cues = await extractSearchCues({
      userId: 'u1',
      normalizedText: 'MCP Bearer key auto-labels agent authorship',
    })
    expect(cues).toEqual(['mcp bearer key', 'agent authorship'])
    expect(llmChatCompletionMock.mock.calls[0]?.[0]?.responseFormat).toBe('json_object')
  })

  it('never asks for any type label (single type axis)', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse({ cues: [] }))
    await extractSearchCues({ userId: 'u1', normalizedText: 'text' })
    const messages = llmChatCompletionMock.mock.calls[0]?.[0]?.messages as Array<{
      content: string
    }>
    const prompt = messages.map((m) => m.content).join('\n')
    expect(prompt).not.toContain('memoryType')
    expect(prompt).not.toContain('category')
  })

  it('throws when the response has no choices', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [] })
    await expect(extractSearchCues({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow(
      /no choices/,
    )
  })
})
