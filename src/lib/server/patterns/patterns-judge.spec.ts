import type { PatternsLlmInput } from './patterns-input'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPatternsJudgeMessages, runPatternsJudge } from './patterns-judge'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function llmContent(content: unknown) {
  return { choices: [{ message: { role: 'assistant', content } }] }
}

function judgeInput(): PatternsLlmInput {
  return {
    window: { days: 21, startDate: '2026-09-30', endDate: '2026-10-20' },
    totalThoughts: 12,
    thoughtsPerDay: [{ date: '2026-10-19', count: 3 }],
    categoryMix: [{ category: 'todo', count: 5 }],
    communityActivity: [{ name: 'Atlas threads', recentThoughtCount: 4 }],
    threadActivity: [{ label: 'Studio rebuild', recentThoughtCount: 3 }],
    thoughtCatalog: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        day: '2026-10-19',
        category: 'todo',
        communities: ['Atlas threads'],
        summary: 'Ship the Atlas export',
      },
    ],
  }
}

describe('buildPatternsJudgeMessages', () => {
  it('states the JSON contract, the kind enum and the catalog-binding rule in the system prompt', () => {
    const messages = buildPatternsJudgeMessages(judgeInput())
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('"insight"')
    expect(messages[0].content).toContain('thoughtIds')
    expect(messages[0].content).toContain('recurring')
    expect(messages[0].content).toContain('scattered')
    expect(messages[0].content).toContain('growing')
    expect(messages[0].content).toContain('fading')
    expect(messages[0].content).toContain('exactly')
  })

  it('passes the structured summaries as the user message, including catalog ids', () => {
    const messages = buildPatternsJudgeMessages(judgeInput())
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('11111111-1111-1111-1111-111111111111')
    expect(messages[1].content).toContain('Atlas threads')
    expect(messages[1].content).toContain('2026-10-19')
  })
})

describe('runPatternsJudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the gateway with the user id, both messages and temperature 0', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent('{"insight":"i","patterns":[]}'),
    )
    await runPatternsJudge('user-1', judgeInput())
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const call = llmChatCompletionMock.mock.calls[0][0] as {
      userId: string
      messages: Array<{ role: string }>
      temperature: number
    }
    expect(call.userId).toBe('user-1')
    expect(call.messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(call.temperature).toBe(0)
  })

  it('returns the parsed payload from a plain JSON answer', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent('{"insight":"Lately, you keep returning to Atlas.","patterns":[]}'),
    )
    const payload = await runPatternsJudge('user-1', judgeInput())
    expect(payload).toEqual({ insight: 'Lately, you keep returning to Atlas.', patterns: [] })
  })

  it('parses an answer wrapped in markdown fences', async () => {
    llmChatCompletionMock.mockResolvedValue(
      llmContent('```json\n{"insight":"i","patterns":[]}\n```'),
    )
    const payload = await runPatternsJudge('user-1', judgeInput())
    expect(payload).toEqual({ insight: 'i', patterns: [] })
  })

  it('throws (no fallback) when the response carries no content', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [] })
    await expect(runPatternsJudge('user-1', judgeInput())).rejects.toThrow()
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('throws (no fallback) when the answer is not valid JSON', async () => {
    llmChatCompletionMock.mockResolvedValue(llmContent('not json at all'))
    await expect(runPatternsJudge('user-1', judgeInput())).rejects.toThrow()
  })

  it('propagates gateway failures instead of degrading silently', async () => {
    llmChatCompletionMock.mockRejectedValue(new Error('gateway down'))
    await expect(runPatternsJudge('user-1', judgeInput())).rejects.toThrow('gateway down')
  })
})
