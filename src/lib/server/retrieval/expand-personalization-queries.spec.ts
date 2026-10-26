import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expandPersonalizationQueries,
  parseExpansionQueriesResponse,
  PERSONALIZATION_EXPANSION_PROMPT,
} from './expand-personalization-queries'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))

vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

function reply(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('parseExpansionQueriesResponse', () => {
  it('parses 2-4 trimmed queries', () => {
    expect(
      parseExpansionQueriesResponse('{"queries":[" health limits ","foods avoided"]}'),
    ).toEqual(['health limits', 'foods avoided'])
    expect(parseExpansionQueriesResponse('{"queries":["a","b","c","d"]}')).toHaveLength(4)
  })

  it('fails loud on a non-object, a missing/non-array queries key, or a bad count', () => {
    expect(() => parseExpansionQueriesResponse('not json')).toThrow()
    expect(() => parseExpansionQueriesResponse('["a","b"]')).toThrow(/queries/)
    expect(() => parseExpansionQueriesResponse('{}')).toThrow(/queries/)
    expect(() => parseExpansionQueriesResponse('{"queries":"a"}')).toThrow(/queries/)
    expect(() => parseExpansionQueriesResponse('{"queries":["only one"]}')).toThrow(/2 to 4/)
    expect(() => parseExpansionQueriesResponse('{"queries":["a","b","c","d","e"]}')).toThrow(
      /2 to 4/,
    )
  })

  it('fails loud on non-string or blank entries (nothing is silently dropped)', () => {
    expect(() => parseExpansionQueriesResponse('{"queries":["a",2]}')).toThrow(/non-empty strings/)
    expect(() => parseExpansionQueriesResponse('{"queries":["a","  "]}')).toThrow(
      /non-empty strings/,
    )
  })
})

describe('expandPersonalizationQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    llmChatCompletionMock.mockResolvedValue(reply('{"queries":["foods the user avoids","energy"]}'))
  })

  it('makes exactly one json_object call whose only user input is the question', async () => {
    const queries = await expandPersonalizationQueries({
      userId: 'u1',
      question: 'What should I eat before my run?',
    })

    expect(queries).toEqual(['foods the user avoids', 'energy'])
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const arg = llmChatCompletionMock.mock.calls[0]![0] as {
      userId: string
      messages: Array<{ role: string; content: string }>
      responseFormat: string
      logContext: string
    }
    expect(arg.userId).toBe('u1')
    expect(arg.responseFormat).toBe('json_object')
    expect(arg.logContext).toBe('personalization_query_expansion')
    expect(arg.messages).toEqual([
      { role: 'system', content: PERSONALIZATION_EXPANSION_PROMPT },
      { role: 'user', content: 'What should I eat before my run?' },
    ])
  })

  it('rejects an empty question before any LLM call', async () => {
    await expect(expandPersonalizationQueries({ userId: 'u1', question: '  ' })).rejects.toThrow(
      /non-empty/,
    )
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('fails loud on an empty or malformed reply (no fallback to the bare question)', async () => {
    llmChatCompletionMock.mockResolvedValue(reply(''))
    await expect(expandPersonalizationQueries({ userId: 'u1', question: 'q' })).rejects.toThrow(
      /empty/,
    )
    llmChatCompletionMock.mockResolvedValue(reply('{"queries":["one"]}'))
    await expect(expandPersonalizationQueries({ userId: 'u1', question: 'q' })).rejects.toThrow(
      /2 to 4/,
    )
  })
})
