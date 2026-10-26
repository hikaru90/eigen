import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import {
  JUDGE_FORGET_TARGET_PROMPT,
  judgeForgetTarget,
  parseForgetTargetJudgement,
} from './judge-forget-target'

function reply(json: unknown) {
  return {
    choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }],
  }
}

describe('parseForgetTargetJudgement', () => {
  it('parses archive', () => {
    expect(parseForgetTargetJudgement('{"action":"archive"}')).toEqual({ action: 'archive' })
  })

  it('parses edit_out with the detail to remove', () => {
    expect(
      parseForgetTargetJudgement('{"action":"edit_out","detail":" the peanut allergy "}'),
    ).toEqual({ action: 'edit_out', detail: 'the peanut allergy' })
  })

  it('rejects edit_out without a detail', () => {
    expect(() => parseForgetTargetJudgement('{"action":"edit_out"}')).toThrow(/detail/)
    expect(() => parseForgetTargetJudgement('{"action":"edit_out","detail":"  "}')).toThrow(
      /detail/,
    )
  })

  it('rejects an action outside archive | edit_out (no repair)', () => {
    expect(() => parseForgetTargetJudgement('{"action":"keep"}')).toThrow(/action/)
    expect(() => parseForgetTargetJudgement('not json')).toThrow()
  })
})

describe('judgeForgetTarget', () => {
  beforeEach(() => llmChatCompletionMock.mockReset())

  it('asks in json mode with the request and the full target text, and returns the judgement', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({ action: 'edit_out', detail: 'that I like surfing' }),
    )
    const out = await judgeForgetTarget({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      targetText: 'I like surfing and I work as a nurse.',
    })
    expect(out).toEqual({ action: 'edit_out', detail: 'that I like surfing' })
    const call = llmChatCompletionMock.mock.calls[0][0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.messages[0].content).toBe(JUDGE_FORGET_TARGET_PROMPT)
    expect(call.messages[1].content).toContain('Please forget that I like surfing')
    expect(call.messages[1].content).toContain('I like surfing and I work as a nurse.')
  })

  it('the prompt defines both outcomes by meaning and makes no keyword rule', () => {
    expect(JUDGE_FORGET_TARGET_PROMPT).toMatch(/archive/)
    expect(JUDGE_FORGET_TARGET_PROMPT).toMatch(/edit_out/)
    expect(JUDGE_FORGET_TARGET_PROMPT).toMatch(/only about/i)
    expect(JUDGE_FORGET_TARGET_PROMPT).toMatch(/any language/i)
  })

  it('throws on an empty LLM reply', async () => {
    llmChatCompletionMock.mockResolvedValue(reply(''))
    await expect(
      judgeForgetTarget({ userId: 'u1', forgetRequest: 'r', targetText: 't' }),
    ).rejects.toThrow(/empty/)
  })
})
