import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOARD_JUDGE_FAILED_MESSAGE,
  BOARD_JUDGE_MAX_ATTEMPTS,
  buildBoardJudgeMessages,
  judgeBoardIdea,
  parseBoardJudgeOutput,
  type BoardJudgeCandidate,
} from './judge'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))

vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

const DARK = '11111111-1111-4111-8111-111111111111'
const SEARCH = '22222222-2222-4222-8222-222222222222'

const candidates: BoardJudgeCandidate[] = [
  { id: DARK, title: 'Dark mode for Mesh', kind: 'idea', area: 'yarn', status: 'requested' },
  { id: SEARCH, title: 'Search misses accents', kind: 'bug', area: 'yarn', status: 'in-progress' },
]

function reply(payload: unknown) {
  return { choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) } }] }
}

describe('board judge prompt contract', () => {
  it('sends the kind/area ontology, the JSON schema and the candidates — never embeddings', () => {
    const messages = buildBoardJudgeMessages('Mesh needs a dark theme', candidates)
    const system = messages[0].content
    expect(messages[0].role).toBe('system')
    for (const key of [
      'idea',
      'bug',
      'polish',
      'capture',
      'yarn',
      'threads',
      'patterns',
      'ask',
      'better',
      'everywhere',
    ]) {
      expect(system).toContain(`"${key}"`)
    }
    expect(system).toContain('duplicate_of')
    const user = messages[1].content
    expect(user).toContain('Mesh needs a dark theme')
    expect(user).toContain(DARK)
    expect(user).toContain('Dark mode for Mesh')
    expect(user).not.toMatch(/embedding/i)
  })

  it('says plainly when there are no candidates', () => {
    const messages = buildBoardJudgeMessages('Something new', [])
    expect(messages[1].content).toMatch(/no existing ideas/i)
  })
})

describe('parseBoardJudgeOutput', () => {
  const ids = new Set([DARK, SEARCH])

  it('accepts a valid decision', () => {
    expect(
      parseBoardJudgeOutput(
        JSON.stringify({ kind: 'idea', area: 'yarn', duplicate_of: DARK }),
        ids,
      ),
    ).toEqual({ kind: 'idea', area: 'yarn', duplicateOfId: DARK })
    expect(
      parseBoardJudgeOutput(
        JSON.stringify({ kind: 'bug', area: 'capture', duplicate_of: null }),
        ids,
      ),
    ).toEqual({ kind: 'bug', area: 'capture', duplicateOfId: null })
  })

  it('rejects malformed output instead of defaulting', () => {
    expect(() => parseBoardJudgeOutput('not json', ids)).toThrow()
    expect(() =>
      parseBoardJudgeOutput(
        JSON.stringify({ kind: 'feature', area: 'yarn', duplicate_of: null }),
        ids,
      ),
    ).toThrow()
    expect(() =>
      parseBoardJudgeOutput(
        JSON.stringify({ kind: 'idea', area: 'mars', duplicate_of: null }),
        ids,
      ),
    ).toThrow()
    expect(() =>
      parseBoardJudgeOutput(JSON.stringify({ kind: 'idea', area: 'yarn' }), ids),
    ).toThrow()
  })

  it('rejects a duplicate id that was not among the candidates', () => {
    expect(() =>
      parseBoardJudgeOutput(
        JSON.stringify({
          kind: 'idea',
          area: 'yarn',
          duplicate_of: '33333333-3333-4333-8333-333333333333',
        }),
        ids,
      ),
    ).toThrow(/not one of the candidates/)
  })
})

describe('judgeBoardIdea', () => {
  beforeEach(() => {
    llmChatCompletionMock.mockReset()
  })

  it('AC-12: returns the duplicate the judge picked (paraphrase, different words)', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(
      reply({ kind: 'idea', area: 'yarn', duplicate_of: DARK }),
    )
    const decision = await judgeBoardIdea({
      userId: 'u1',
      title: 'Mesh needs a dark theme',
      candidates,
    })
    expect(decision.duplicateOfId).toBe(DARK)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(llmChatCompletionMock.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      logContext: 'board_idea_judge',
      responseFormat: 'json_object',
      temperature: 0,
    })
  })

  it('regression: same area and shared words is NOT a duplicate when the judge says so', async () => {
    // "Dark mode for Mesh" vs "Dark mode for Capture" share words and area; code must not
    // second-guess the judge with any lexical rule.
    llmChatCompletionMock.mockResolvedValueOnce(
      reply({ kind: 'idea', area: 'capture', duplicate_of: null }),
    )
    const decision = await judgeBoardIdea({
      userId: 'u1',
      title: 'Dark mode for Capture',
      candidates,
    })
    expect(decision).toEqual({ kind: 'idea', area: 'capture', duplicateOfId: null })
  })

  it('regression: an identical title is still only a duplicate if the judge says so', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(
      reply({ kind: 'idea', area: 'yarn', duplicate_of: null }),
    )
    const decision = await judgeBoardIdea({ userId: 'u1', title: 'Dark mode for Mesh', candidates })
    expect(decision.duplicateOfId).toBeNull()
  })

  it('AC-13: kind and area come from the judge', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(
      reply({ kind: 'bug', area: 'capture', duplicate_of: null }),
    )
    const decision = await judgeBoardIdea({
      userId: 'u1',
      title: 'Voice capture cuts off',
      candidates: [],
    })
    expect(decision).toEqual({ kind: 'bug', area: 'capture', duplicateOfId: null })
  })

  it('retries malformed output and succeeds within the budget', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce(reply({ kind: 'nope' }))
      .mockResolvedValueOnce(reply({ kind: 'polish', area: 'patterns', duplicate_of: null }))
    const decision = await judgeBoardIdea({ userId: 'u1', title: 'Map labels overlap', candidates })
    expect(decision.kind).toBe('polish')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
  })

  it('AC-16: fails with a plain error after exactly 3 attempts', async () => {
    expect(BOARD_JUDGE_MAX_ATTEMPTS).toBe(3)
    llmChatCompletionMock.mockRejectedValue(new Error('LLM HTTP 503'))
    await expect(judgeBoardIdea({ userId: 'u1', title: 'x', candidates })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining(BOARD_JUDGE_FAILED_MESSAGE),
    })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry when the wallet is empty — the 402 surfaces as-is', async () => {
    const credits = Object.assign(new Error('Insufficient credits'), {
      name: 'InsufficientCreditsError',
    })
    llmChatCompletionMock.mockRejectedValue(credits)
    await expect(judgeBoardIdea({ userId: 'u1', title: 'x', candidates })).rejects.toBe(credits)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })
})
