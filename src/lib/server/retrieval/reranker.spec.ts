import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RerankError,
  extractJsonArraysFromText,
  rerankCandidates,
  resolveRankedIds,
  shouldSkipRerank,
} from './reranker'
import type { RerankCandidate } from './reranker'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function makeResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

const candidates: RerankCandidate[] = [
  { id: 'a', normalizedText: 'Anna pushed back on Q3 pricing', score: 0.9 },
  { id: 'b', normalizedText: 'Marcus sent the contract yesterday', score: 0.8 },
  { id: 'c', normalizedText: 'Meeting notes from Monday standup', score: 0.7 },
]

describe('rerankCandidates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reorders candidates according to LLM ranked IDs', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('["c", "a", "b"]'))

    const result = await rerankCandidates('u1', 'standup notes', candidates)
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('throws RerankError when LLM returns invalid JSON', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('not valid json'))
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toBeInstanceOf(RerankError)
  })

  it('throws RerankError when LLM call fails', async () => {
    llmChatCompletionMock.mockRejectedValue(new Error('LLM error'))
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toBeInstanceOf(RerankError)
  })

  it('throws RerankError when LLM returns non-array JSON', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('{"ids": ["a","b"]}'))
    const result = await rerankCandidates('u1', 'query', candidates)
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('throws RerankError when LLM returns JSON without any ID arrays', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('{"reason": "none relevant"}'))
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toBeInstanceOf(RerankError)
  })

  it('returns input unchanged for single candidate', async () => {
    const single = [candidates[0]]
    const result = await rerankCandidates('u1', 'query', single)
    expect(result).toEqual(single)
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('places candidates with unknown IDs at the end', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('["b"]')) // only returns one ID
    const result = await rerankCandidates('u1', 'query', candidates)
    // b first (ranked), then a and c in their relative original order
    expect(result[0].id).toBe('b')
  })

  it('returns input unchanged when top score gap is large', async () => {
    const spread: RerankCandidate[] = [
      { id: 'a', normalizedText: 'first', score: 0.95 },
      { id: 'b', normalizedText: 'second', score: 0.5 },
      { id: 'c', normalizedText: 'third', score: 0.4 },
    ]
    const result = await rerankCandidates('u1', 'query', spread)
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('shouldSkipRerank detects clear winner', () => {
    expect(
      shouldSkipRerank([
        { id: 'a', normalizedText: 'x', score: 0.9 },
        { id: 'b', normalizedText: 'y', score: 0.5 },
      ]),
    ).toBe(true)
    expect(
      shouldSkipRerank([
        { id: 'a', normalizedText: 'x', score: 0.55 },
        { id: 'b', normalizedText: 'y', score: 0.5 },
      ]),
    ).toBe(false)
  })

  it('includes recent context in the prompt when provided', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('["a","b","c"]'))

    await rerankCandidates('u1', 'pricing discussion', candidates, [
      { normalizedText: 'Just had a call with Anna about next quarter' },
    ])

    const call = llmChatCompletionMock.mock.calls.at(-1)![0]
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMsg.content).toContain('Anna about next quarter')
  })

  it('strips markdown code fences from LLM response', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('```json\n["c","b","a"]\n```'))
    const result = await rerankCandidates('u1', 'query', candidates)
    expect(result.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('parses JSON arrays followed by explanatory prose', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(
        '["id-2", "id-1"]\n\nWait, let me reconsider...\n\n["id-2"]\n\nActually neither helps:\n\n[]',
      ),
    )
    const two = candidates.slice(0, 2)
    const result = await rerankCandidates('u1', 'query', two)
    expect(result.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('maps prompt-style placeholder IDs to candidate positions', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('["id-3", "id-1"]'))
    const result = await rerankCandidates('u1', 'query', candidates)
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('maps id-prefixed uuid strings from the rerank LLM', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('["id-a", "id-b"]'))
    const result = await rerankCandidates('u1', 'query', candidates.slice(0, 2))
    expect(result.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('preserves all candidate fields in output', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('["b","a","c"]'))
    const result = await rerankCandidates('u1', 'query', candidates)
    expect(result[0]).toEqual(candidates[1]) // b
    expect(result[1]).toEqual(candidates[0]) // a
  })

  it('throws RerankError when LLM returns no choices', async () => {
    llmChatCompletionMock.mockResolvedValue({})
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toMatchObject({
      message: 'Rerank LLM returned no choices',
    })
  })

  it('throws RerankError when LLM returns blank content', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] })
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toMatchObject({
      message: 'Rerank LLM returned empty content',
    })
  })

  it('keeps fusion order when the LLM returns an empty ID array', async () => {
    llmChatCompletionMock.mockResolvedValue(makeResponse('[]'))
    const result = await rerankCandidates('u1', 'query', candidates)
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('extractJsonArraysFromText finds multiple arrays in chatty output', () => {
    expect(extractJsonArraysFromText('["id-2"]\n\nReasoning...\n\n["id-1"]')).toEqual([
      ['id-2'],
      ['id-1'],
    ])
  })

  it('resolveRankedIds accepts numeric and placeholder IDs', () => {
    expect(resolveRankedIds(['id-2', 1], candidates)).toEqual(['b', 'a'])
  })

  it('resolveRankedIds accepts id-prefixed uuid strings', () => {
    expect(resolveRankedIds(['id-a', 'id-c'], candidates)).toEqual(['a', 'c'])
  })

  it('wraps non-Error LLM failures and parse failures', async () => {
    llmChatCompletionMock.mockRejectedValueOnce('gateway down')
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toMatchObject({
      message: 'Rerank LLM call failed: gateway down',
    })

    llmChatCompletionMock.mockResolvedValueOnce(makeResponse('not valid json'))
    await expect(rerankCandidates('u1', 'query', candidates)).rejects.toMatchObject({
      message: 'Rerank LLM response is not a JSON array',
    })
  })
})
