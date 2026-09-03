import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  filterOrderedThoughtIds,
  parseProjectOrderPayload,
  shouldInvokeProjectOrderJudge,
  extractProjectOrder,
} from './extract-project-order'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function makeResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('shouldInvokeProjectOrderJudge', () => {
  it('is structural only: requires at least 2 open tasks', () => {
    expect(shouldInvokeProjectOrderJudge(0)).toBe(false)
    expect(shouldInvokeProjectOrderJudge(1)).toBe(false)
    expect(shouldInvokeProjectOrderJudge(2)).toBe(true)
    expect(shouldInvokeProjectOrderJudge(5)).toBe(true)
  })
})

describe('filterOrderedThoughtIds', () => {
  it('keeps allowed ids in LLM order and drops extras/duplicates', () => {
    expect(filterOrderedThoughtIds(['b', 'a', 'b', 'zzz', 'c'], new Set(['a', 'b', 'c']))).toEqual([
      'b',
      'a',
      'c',
    ])
  })

  it('returns empty when nothing allowed', () => {
    expect(filterOrderedThoughtIds(['x'], new Set(['a']))).toEqual([])
  })
})

describe('parseProjectOrderPayload', () => {
  it('parses orderedThoughtIds and filters to allowed set', () => {
    expect(
      parseProjectOrderPayload(
        { orderedThoughtIds: ['t2', 't1', 'foreign'] },
        new Set(['t1', 't2']),
      ),
    ).toEqual(['t2', 't1'])
  })

  it('accepts snake_case ordered_thought_ids', () => {
    expect(parseProjectOrderPayload({ ordered_thought_ids: ['t1'] }, new Set(['t1']))).toEqual([
      't1',
    ])
  })

  it('returns empty for non-object or missing array', () => {
    expect(parseProjectOrderPayload(null, new Set(['t1']))).toEqual([])
    expect(parseProjectOrderPayload({}, new Set(['t1']))).toEqual([])
  })
})

describe('extractProjectOrder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns LLM order filtered to project open tasks', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(JSON.stringify({ orderedThoughtIds: ['t2', 't1', 'not-in-project'] })),
    )

    const result = await extractProjectOrder({
      userId: 'u1',
      projectLabel: 'Ship header',
      openTasks: [
        { thoughtId: 't1', summary: 'Draft copy' },
        { thoughtId: 't2', summary: 'Review with design' },
      ],
    })

    expect(result).toEqual(['t2', 't1'])
    expect(llmChatCompletionMock).toHaveBeenCalled()
  })

  it('skips LLM when fewer than 2 open tasks', async () => {
    const result = await extractProjectOrder({
      userId: 'u1',
      projectLabel: 'Solo',
      openTasks: [{ thoughtId: 't1', summary: 'Only one' }],
    })
    expect(result).toEqual(['t1'])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })
})
