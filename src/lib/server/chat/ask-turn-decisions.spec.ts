import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runBoundedMock } = vi.hoisted(() => ({ runBoundedMock: vi.fn() }))

vi.mock('$lib/server/llm/decision-plane', () => ({
  runEnforcedBoundedDecisions: runBoundedMock,
}))
vi.mock('$lib/paraglide/messages.js', () => ({
  m: {
    ask_capture_check_failed: () => 'NOTE capture check failed',
    ask_reply_check_failed: () => 'NOTE reply check failed',
  },
}))

import {
  buildAskTurnState,
  CAPTURE_WORTHY_CRITERIA,
  decideAskTurn,
  PROPOSAL_REPLY_CRITERIA,
  planAskTurn,
} from './ask-turn-decisions'

const answer = (choice: string) => ({
  type: 'choice' as const,
  choice,
  probabilities: { [choice]: 0.9 },
  confidence: 0.9,
})

const OPEN = { proposalId: 'p1', thoughts: ['Starts bouldering on Tuesdays', 'Climbs with Jonas'] }

describe('decideAskTurn (AP-1 / AP-3: one Decisions call per turn)', () => {
  beforeEach(() => {
    runBoundedMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('asks capture_worthy alone, on the raw message, when no proposal is open', async () => {
    runBoundedMock.mockResolvedValue(new Map([['capture_worthy', answer('yes')]]))

    const result = await decideAskTurn({
      userId: 'u1',
      message: 'I started bouldering',
      openProposal: null,
    })

    expect(runBoundedMock).toHaveBeenCalledTimes(1)
    const call = runBoundedMock.mock.calls[0]![0]
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('chat_turn')
    expect(call.state).toBe('I started bouldering')
    expect(call.specs).toHaveLength(1)
    expect(call.specs[0]).toMatchObject({
      decisionKind: 'capture_worthy',
      id: 'capture_worthy',
      llmChoice: null,
      question: { type: 'choice', criteria: CAPTURE_WORTHY_CRITERIA },
    })
    expect(Object.keys(CAPTURE_WORTHY_CRITERIA)).toEqual(['yes', 'no'])
    expect(result).toEqual({
      captureWorthy: 'yes',
      proposalReply: null,
      openProposal: null,
      notes: [],
    })
  })

  it('adds proposal_reply to the SAME call when a proposal is open, with the proposal in the state', async () => {
    runBoundedMock.mockResolvedValue(
      new Map([
        ['capture_worthy', answer('no')],
        ['proposal_reply', answer('confirm')],
      ]),
    )

    const result = await decideAskTurn({ userId: 'u1', message: 'yes', openProposal: OPEN })

    expect(runBoundedMock).toHaveBeenCalledTimes(1)
    const call = runBoundedMock.mock.calls[0]![0]
    expect(call.specs.map((s: { id: string }) => s.id)).toEqual([
      'capture_worthy',
      'proposal_reply',
    ])
    expect(call.specs[1]).toMatchObject({
      decisionKind: 'proposal_reply',
      llmChoice: null,
      question: { type: 'choice', criteria: PROPOSAL_REPLY_CRITERIA },
    })
    expect(Object.keys(PROPOSAL_REPLY_CRITERIA)).toEqual(['confirm', 'revise', 'unrelated'])
    expect(call.state).toBe(buildAskTurnState({ message: 'yes', openProposal: OPEN }))
    expect(call.state).toContain('1. Starts bouldering on Tuesdays')
    expect(call.state).toContain('2. Climbs with Jonas')
    expect(call.state.endsWith('yes')).toBe(true)
    expect(result).toEqual({
      captureWorthy: 'no',
      proposalReply: 'confirm',
      openProposal: OPEN,
      notes: [],
    })
  })

  it('a rejected call leaves both decisions null and adds a visible note (AC-7), never a silent skip', async () => {
    runBoundedMock.mockRejectedValue(new Error('decisions api down'))

    const result = await decideAskTurn({ userId: 'u1', message: 'hello', openProposal: null })

    expect(result.captureWorthy).toBeNull()
    expect(result.proposalReply).toBeNull()
    expect(result.notes).toEqual(['NOTE capture check failed'])
    expect(console.error).toHaveBeenCalledWith('[ask-turn] decision failed', expect.any(Error))
  })

  it('a failure with an open proposal also says the reply was not applied', async () => {
    runBoundedMock.mockRejectedValue(new Error('decisions api down'))

    const result = await decideAskTurn({ userId: 'u1', message: 'yes', openProposal: OPEN })

    expect(result.proposalReply).toBeNull()
    expect(result.openProposal).toEqual(OPEN)
    expect(result.notes).toEqual(['NOTE capture check failed', 'NOTE reply check failed'])
  })

  it('an answer missing from the response counts as a failed decision, not as "no"', async () => {
    runBoundedMock.mockResolvedValue(new Map())

    const result = await decideAskTurn({ userId: 'u1', message: 'hello', openProposal: null })

    expect(result.captureWorthy).toBeNull()
    expect(result.notes).toEqual(['NOTE capture check failed'])
  })
})

describe('planAskTurn', () => {
  const base = { openProposal: null as typeof OPEN | null, notes: [] as string[] }

  it('capture_worthy yes requires propose_thoughts and tells the model so', () => {
    const plan = planAskTurn({ ...base, captureWorthy: 'yes', proposalReply: null })
    expect(plan.requiredTool).toBe('propose_thoughts')
    expect(plan.hints.join('\n')).toContain('capture_worthy: yes')
    expect(plan.hints.join('\n')).toContain('propose_thoughts')
  })

  it('capture_worthy no requires nothing and forbids proposing', () => {
    const plan = planAskTurn({ ...base, captureWorthy: 'no', proposalReply: null })
    expect(plan.requiredTool).toBeNull()
    expect(plan.hints.join('\n')).toContain('capture_worthy: no')
  })

  it('confirm requires store_thoughts with the open proposal id, even when capture_worthy says yes', () => {
    const plan = planAskTurn({
      captureWorthy: 'yes',
      proposalReply: 'confirm',
      openProposal: OPEN,
      notes: [],
    })
    expect(plan.requiredTool).toBe('store_thoughts')
    const hints = plan.hints.join('\n')
    expect(hints).toContain('proposal_reply: confirm')
    expect(hints).toContain('p1')
    expect(hints).toContain('1. Starts bouldering on Tuesdays')
  })

  it('revise requires a new propose_thoughts with the open proposal visible', () => {
    const plan = planAskTurn({
      captureWorthy: 'no',
      proposalReply: 'revise',
      openProposal: OPEN,
      notes: [],
    })
    expect(plan.requiredTool).toBe('propose_thoughts')
    expect(plan.hints.join('\n')).toContain('2. Climbs with Jonas')
  })

  it('unrelated closes the proposal: nothing required, nothing stored', () => {
    const plan = planAskTurn({
      captureWorthy: 'no',
      proposalReply: 'unrelated',
      openProposal: OPEN,
      notes: [],
    })
    expect(plan.requiredTool).toBeNull()
    expect(plan.hints.join('\n')).toContain('proposal_reply: unrelated')
  })

  it('failed decisions require nothing and forbid both tools', () => {
    const plan = planAskTurn({ ...base, captureWorthy: null, proposalReply: null, notes: ['n'] })
    expect(plan.requiredTool).toBeNull()
    expect(plan.hints.join('\n')).toMatch(/do not call propose_thoughts or store_thoughts/)
  })
})
