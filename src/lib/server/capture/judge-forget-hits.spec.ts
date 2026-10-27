import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import type { ForgetHit } from './find-forget-hits'
import {
  FORGET_CONFIDENCE_MIN,
  JUDGE_FORGET_HITS_PROMPT,
  judgeForgetHits,
  parseForgetHitDecisions,
} from './judge-forget-hits'

function reply(json: unknown) {
  return {
    choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }],
  }
}

const thought = (id: string, text: string): ForgetHit => ({
  kind: 'thought',
  id,
  text,
  category: 'observation',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  score: 0.9,
})
const note = (id: string, title: string, text: string): ForgetHit => ({
  kind: 'note',
  id,
  title,
  text,
  matchedOrdinals: [1],
  createdAt: new Date('2026-05-20T00:00:00Z'),
  score: 0.8,
})

const fact = (id: string, text: string, over: Partial<Extract<ForgetHit, { kind: 'fact' }>> = {}): ForgetHit => ({
  kind: 'fact',
  id,
  text,
  subject: 'the user',
  factKind: 'habit',
  inferred: false,
  createdAt: new Date('2026-05-10T00:00:00Z'),
  score: 0.85,
  ...over,
})

describe('parseForgetHitDecisions', () => {
  const refs = ['h1', 'h2', 'h3']

  it('parses one decision per hit, in any order, keyed by ref', () => {
    const out = parseForgetHitDecisions(
      JSON.stringify({
        decisions: [
          { hit: 'h3', action: 'keep', confidence: 0.95 },
          { hit: 'h1', action: 'remove_all', confidence: 0.9 },
          { hit: 'h2', action: 'remove_detail', detail: ' the surfing hobby ', confidence: 0.85 },
        ],
      }),
      refs,
    )
    expect(out.get('h1')).toEqual({ action: 'remove_all', confidence: 0.9 })
    expect(out.get('h2')).toEqual({
      action: 'remove_detail',
      detail: 'the surfing hobby',
      confidence: 0.85,
    })
    expect(out.get('h3')).toEqual({ action: 'keep', confidence: 0.95 })
  })

  it('rejects a reply that skips, repeats or invents a hit (no repair)', () => {
    const d = (hit: string) => ({ hit, action: 'keep', confidence: 0.9 })
    expect(() => parseForgetHitDecisions(JSON.stringify({ decisions: [d('h1'), d('h2')] }), refs)).toThrow(/h3/)
    expect(() =>
      parseForgetHitDecisions(JSON.stringify({ decisions: [d('h1'), d('h1'), d('h2'), d('h3')] }), refs),
    ).toThrow(/more than once/)
    expect(() =>
      parseForgetHitDecisions(JSON.stringify({ decisions: [d('h1'), d('h2'), d('h3'), d('h9')] }), refs),
    ).toThrow(/h9/)
  })

  it('rejects an unknown action, a missing detail and a confidence outside [0, 1]', () => {
    const one = (decision: unknown) =>
      parseForgetHitDecisions(JSON.stringify({ decisions: [decision] }), ['h1'])
    expect(() => one({ hit: 'h1', action: 'archive', confidence: 0.9 })).toThrow(/action/)
    expect(() => one({ hit: 'h1', action: 'remove_detail', confidence: 0.9 })).toThrow(/detail/)
    expect(() => one({ hit: 'h1', action: 'remove_detail', detail: '  ', confidence: 0.9 })).toThrow(/detail/)
    expect(() => one({ hit: 'h1', action: 'keep', confidence: 1.2 })).toThrow(/confidence/)
    expect(() => one({ hit: 'h1', action: 'keep', confidence: '0.9' })).toThrow(/confidence/)
    expect(() => one({ hit: 'h1', action: 'keep' })).toThrow(/confidence/)
  })

  it('rejects non-JSON and a missing decisions array', () => {
    expect(() => parseForgetHitDecisions('not json', refs)).toThrow()
    expect(() => parseForgetHitDecisions('{"decisions":"x"}', refs)).toThrow(/decisions/)
    expect(() => parseForgetHitDecisions('[]', refs)).toThrow(/object/)
  })
})

describe('judgeForgetHits', () => {
  beforeEach(() => llmChatCompletionMock.mockReset())

  it('asks once, in json mode, with the request and every hit in full, and maps decisions back to hits', async () => {
    const long = `${'A long story about a trip. '.repeat(40)}I like surfing.`
    const hits = [
      thought('t1', 'I like surfing'),
      note('n1', 'Travel diary', long),
      thought('t2', 'I work as a nurse'),
    ]
    llmChatCompletionMock.mockResolvedValue(
      reply({
        decisions: [
          { hit: 'h1', action: 'remove_all', confidence: 0.95 },
          { hit: 'h2', action: 'remove_detail', detail: 'that I like surfing', confidence: 0.9 },
          { hit: 'h3', action: 'keep', confidence: 0.97 },
        ],
      }),
    )

    const out = await judgeForgetHits({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      hits,
    })

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const call = llmChatCompletionMock.mock.calls[0][0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.messages[0].content).toBe(JUDGE_FORGET_HITS_PROMPT)
    const user = call.messages[1].content as string
    expect(user).toContain('Please forget that I like surfing')
    // full text, not a snippet
    expect(user).toContain(long)
    expect(user).toContain('Travel diary')
    for (const ref of ['h1', 'h2', 'h3']) expect(user).toContain(`[${ref}]`)
    // ids never reach the model
    expect(user).not.toContain('t1')

    expect(out).toEqual([
      { hit: hits[0], action: 'remove_all', confidence: 0.95 },
      { hit: hits[1], action: 'remove_detail', detail: 'that I like surfing', confidence: 0.9 },
      { hit: hits[2], action: 'keep', confidence: 0.97 },
    ])
  })

  it('shows a fact in full with who it is about, its kind, its as-of date and whether it was inferred', async () => {
    const hits = [
      fact('f1', 'Drinks three coffees a day'),
      fact('f2', 'Mia (friend) keeps getting headaches', {
        subject: 'Mia (friend)',
        factKind: 'health',
        inferred: true,
      }),
    ]
    llmChatCompletionMock.mockResolvedValue(
      reply({
        decisions: [
          { hit: 'h1', action: 'remove_all', confidence: 0.95 },
          { hit: 'h2', action: 'keep', confidence: 0.9 },
        ],
      }),
    )

    const out = await judgeForgetHits({ userId: 'u1', forgetRequest: 'forget that I drink coffee', hits })

    const user = llmChatCompletionMock.mock.calls[0][0].messages[1].content as string
    expect(user).toContain('[h1] fact about the user (habit, as of 2026-05-10):\nDrinks three coffees a day')
    expect(user).toContain(
      '[h2] fact about Mia (friend) (health, inferred, as of 2026-05-10):\nMia (friend) keeps getting headaches',
    )
    expect(user).not.toContain('f1')
    expect(out.map((j) => j.action)).toEqual(['remove_all', 'keep'])
  })

  it('no hits: no LLM call', async () => {
    expect(await judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [] })).toEqual([])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('throws on an empty or malformed reply (the retry ladder owns recovery)', async () => {
    llmChatCompletionMock.mockResolvedValue(reply(''))
    await expect(
      judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow(/empty/)
    llmChatCompletionMock.mockResolvedValue(reply({ decisions: [] }))
    await expect(
      judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow(/h1/)
  })

  it('the prompt defines the three outcomes by meaning, keeps earlier forget requests, and makes no keyword rule', () => {
    for (const word of ['remove_all', 'remove_detail', 'keep', 'confidence']) {
      expect(JUDGE_FORGET_HITS_PROMPT).toContain(word)
    }
    expect(JUDGE_FORGET_HITS_PROMPT).toMatch(/any language/i)
    expect(JUDGE_FORGET_HITS_PROMPT).toMatch(/earlier request to forget/i)
    expect(JUDGE_FORGET_HITS_PROMPT).toContain(String(FORGET_CONFIDENCE_MIN))
  })

  it('the prompt explains facts: short statements derived from captures, forgotten with the thing they state', () => {
    expect(JUDGE_FORGET_HITS_PROMPT).toMatch(/facts/i)
    expect(JUDGE_FORGET_HITS_PROMPT).toMatch(/about the user or about another person/i)
  })
})

describe('FORGET_CONFIDENCE_MIN', () => {
  it('is the 0.8 gate of the delete flow', () => {
    expect(FORGET_CONFIDENCE_MIN).toBe(0.8)
  })
})
