import { describe, expect, it, vi } from 'vitest'
import { fetchRelevantCommunitySummaries } from './global'

const { getDbMock, llmChatCompletionMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function mockCommunityDb(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const orderBy = vi.fn(() => ({ limit }))
  const where = vi.fn(() => ({ orderBy }))
  const from = vi.fn(() => ({ where }))
  getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })
  return limit
}

describe('fetchRelevantCommunitySummaries', () => {
  it('returns ordered summaries from the vector search without calling the LLM', async () => {
    mockCommunityDb([
      { communityId: 'c1', level: 1, summaryText: 'Theme one', distance: 0.1 },
      { communityId: 'c2', level: 1, summaryText: 'Theme two', distance: 0.2 },
    ])

    const out = await fetchRelevantCommunitySummaries({
      userId: 'u1',
      queryEmbedding: [0.1, 0.2, 0.3],
      limit: 5,
    })

    expect(out).toEqual([
      { communityId: 'c1', level: 1, summaryText: 'Theme one' },
      { communityId: 'c2', level: 1, summaryText: 'Theme two' },
    ])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it.each([
    { input: undefined, expected: 6 },
    { input: 0, expected: 1 },
    { input: -3, expected: 1 },
    { input: 100, expected: 20 },
  ])('clamps limit $input to $expected', async ({ input, expected }) => {
    const limit = mockCommunityDb([])

    await fetchRelevantCommunitySummaries({
      userId: 'u1',
      queryEmbedding: [0.1, 0.2],
      limit: input,
    })

    expect(limit).toHaveBeenCalledWith(expected)
  })
})
