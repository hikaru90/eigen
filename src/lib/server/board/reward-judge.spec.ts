import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRewardJudgeMessages, judgeIdeaReward, parseRewardJudgeOutput } from './reward-judge'

const { llmMock } = vi.hoisted(() => ({ llmMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))
vi.mock('$lib/server/ontology/llm-json', () => ({
  extractChatContent: (r: { content: string }) => r.content,
}))

const idea = { title: 'Voice input on Contribute', kind: 'idea', area: 'better', note: 'Shipped in d8b1b66' } as const

describe('reward judge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gives the judge the idea and the makers’ note, and asks for JSON only', () => {
    const [system, user] = buildRewardJudgeMessages(idea)
    expect(system.content).toContain('"reward": true | false')
    expect(user.content).toContain('Voice input on Contribute')
    expect(user.content).toContain('Shipped in d8b1b66')
  })

  it('parses a decision and rejects anything off-schema', () => {
    expect(parseRewardJudgeOutput('{"reward": true, "reason": "Real feature request"}')).toEqual({
      reward: true,
      reason: 'Real feature request',
    })
    expect(() => parseRewardJudgeOutput('{"reward": "yes"}')).toThrow(/schema/)
  })

  it('bills the maker, logs the call, and returns the decision', async () => {
    llmMock.mockResolvedValue({ content: '{"reward": false, "reason": "A joke, not a request"}' })
    const out = await judgeIdeaReward({ makerUserId: 'maker-1', idea })
    expect(out).toEqual({ reward: false, reason: 'A joke, not a request' })
    expect(llmMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'maker-1', logContext: 'board_reward_judge', temperature: 0 }),
    )
  })

  it('tries exactly three times, then fails out loud — never a default decision', async () => {
    llmMock.mockResolvedValue({ content: 'not json' })
    await expect(judgeIdeaReward({ makerUserId: 'maker-1', idea })).rejects.toThrow(/3 times/)
    expect(llmMock).toHaveBeenCalledTimes(3)
  })
})
