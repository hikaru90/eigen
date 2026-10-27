import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, captureThoughtMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  captureThoughtMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/capture/service', () => ({ captureThought: captureThoughtMock }))

import type { McpToolContext } from './tools'
import type { AskTurnState } from '$lib/server/chat/ask-proposals'
import { runProposeThoughtsTool, runStoreThoughtsTool } from './ask-proposal-tools'

type Row = { role: string; content: string; metadata: unknown }

const user = (content = 'msg'): Row => ({ role: 'user', content, metadata: null })
const assistant = (content = 'ok'): Row => ({ role: 'assistant', content, metadata: null })
const proposalStep = (proposalId: string, thoughts: string[]): Row => ({
  role: 'assistant',
  content: JSON.stringify({ proposalId, thoughts }),
  metadata: {
    variant: 'tool_step',
    tool: 'propose_thoughts',
    arguments: { thoughts },
    failed: false,
  },
})

/** A db whose chat_message query answers with the given ordered rows. */
function fakeDb(rows: Row[]) {
  return {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
  }
}

function turn(overrides: Partial<AskTurnState> = {}): AskTurnState {
  return {
    sessionId: 's1',
    captureWorthy: 'no',
    proposalReply: null,
    storeStarted: false,
    ...overrides,
  }
}

function ctx(askTurn: AskTurnState | undefined): McpToolContext {
  return { userId: 'u1', ...(askTurn ? { askTurn } : {}) }
}

const PROPOSED = ['Started bouldering on Tuesdays with Jonas', 'Wants a rest day on Wednesday']

/** The session as it stands in the confirm turn: proposal turn, then the user's "yes". */
const confirmSession = (id = 'p1'): Row[] => [
  user('I started bouldering on Tuesdays with Jonas, what should I plan?'),
  proposalStep(id, PROPOSED),
  assistant('I would store these in your mesh'),
  user('yes'),
]

describe('propose_thoughts', () => {
  beforeEach(() => {
    captureThoughtMock.mockReset()
    getDbMock.mockReset()
  })

  it('returns a proposal id and the thoughts, and stores nothing (AC-1)', async () => {
    const result = (await runProposeThoughtsTool(ctx(turn({ captureWorthy: 'yes' })), {
      thoughts: [' Started bouldering on Tuesdays with Jonas ', 'Wants a rest day on Wednesday'],
    })) as { proposalId: string; thoughts: string[] }

    expect(result.proposalId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.thoughts).toEqual(PROPOSED)
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('every proposal gets a fresh id (a new proposal replaces the old one)', async () => {
    const c = ctx(turn({ captureWorthy: 'yes' }))
    const a = (await runProposeThoughtsTool(c, { thoughts: ['a'] })) as { proposalId: string }
    const b = (await runProposeThoughtsTool(c, { thoughts: ['a'] })) as { proposalId: string }
    expect(a.proposalId).not.toBe(b.proposalId)
  })

  it('is allowed on a revise turn even when capture_worthy is no (AC-3)', async () => {
    const result = (await runProposeThoughtsTool(
      ctx(turn({ captureWorthy: 'no', proposalReply: 'revise' })),
      { thoughts: ['Bouldering is on Wednesdays'] },
    )) as { thoughts: string[] }
    expect(result.thoughts).toEqual(['Bouldering is on Wednesdays'])
  })

  it('is rejected when the turn was not judged worth keeping (AC-5)', async () => {
    await expect(
      runProposeThoughtsTool(ctx(turn({ captureWorthy: 'no' })), { thoughts: ['x'] }),
    ).rejects.toThrow(/capture_worthy/)
    await expect(
      runProposeThoughtsTool(ctx(turn({ captureWorthy: null })), { thoughts: ['x'] }),
    ).rejects.toThrow(/capture_worthy/)
  })

  it('is rejected on a confirm turn and on an unrelated turn without capture_worthy yes', async () => {
    await expect(
      runProposeThoughtsTool(ctx(turn({ captureWorthy: 'yes', proposalReply: 'confirm' })), {
        thoughts: ['x'],
      }),
    ).rejects.toThrow(/confirm/)
    await expect(
      runProposeThoughtsTool(ctx(turn({ captureWorthy: 'no', proposalReply: 'unrelated' })), {
        thoughts: ['x'],
      }),
    ).rejects.toThrow(/capture_worthy/)
  })

  it('is unavailable outside an Ask turn', async () => {
    await expect(runProposeThoughtsTool(ctx(undefined), { thoughts: ['x'] })).rejects.toThrow(
      /only available in an Ask chat turn/,
    )
  })

  it('validates the arguments at the boundary', async () => {
    const c = ctx(turn({ captureWorthy: 'yes' }))
    await expect(runProposeThoughtsTool(c, { thoughts: [] })).rejects.toThrow(/at least one/)
    await expect(runProposeThoughtsTool(c, { thoughts: 'x' })).rejects.toThrow(/array/)
    await expect(runProposeThoughtsTool(c, { thoughts: ['x'], extra: 1 })).rejects.toThrow(
      /Unknown argument: extra/,
    )
    await expect(runProposeThoughtsTool(c, null)).rejects.toThrow(/JSON object/)
  })
})

describe('store_thoughts', () => {
  beforeEach(() => {
    captureThoughtMock.mockReset()
    getDbMock.mockReset()
    let n = 0
    captureThoughtMock.mockImplementation(async () => ({ id: `t${++n}` }))
  })

  it('stores exactly the persisted proposal texts as Ask thoughts, linked to the session (AC-2, AP-5)', async () => {
    getDbMock.mockReturnValue(fakeDb(confirmSession('p1')))

    const result = (await runStoreThoughtsTool(ctx(turn({ proposalReply: 'confirm' })), {
      proposal_id: 'p1',
    })) as { proposalId: string; stored: Array<{ thoughtId: string; text: string }> }

    expect(captureThoughtMock).toHaveBeenCalledTimes(2)
    expect(captureThoughtMock.mock.calls.map((c) => c[1])).toEqual(PROPOSED)
    for (const call of captureThoughtMock.mock.calls) {
      expect(call[0]).toBe('u1')
      expect(call[2]).toMatchObject({
        source: 'ask',
        provenance: { askSessionId: 's1', askProposalId: 'p1' },
      })
      // the chat confirmation is the confirmation: no inline enrichment wait, no interpret gate
      expect(call[2].awaitEnrichment).not.toBe(true)
    }
    expect(result.proposalId).toBe('p1')
    expect(result.stored).toEqual([
      { thoughtId: 't1', text: PROPOSED[0] },
      { thoughtId: 't2', text: PROPOSED[1] },
    ])
  })

  it('rejects an Ask turn without a confirmed reply and stores nothing (AC-6)', async () => {
    getDbMock.mockReturnValue(fakeDb(confirmSession('p1')))
    for (const proposalReply of [null, 'revise', 'unrelated'] as const) {
      await expect(
        runStoreThoughtsTool(ctx(turn({ proposalReply })), { proposal_id: 'p1' }),
      ).rejects.toThrow(/not confirmed/)
    }
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('rejects when no proposal exists in the session', async () => {
    getDbMock.mockReturnValue(fakeDb([user('hello'), assistant('hi'), user('yes')]))
    await expect(
      runStoreThoughtsTool(ctx(turn({ proposalReply: 'confirm' })), { proposal_id: 'p1' }),
    ).rejects.toThrow(/no open proposal/)
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('rejects a stale proposal that is not in the directly-next user turn (AC-4)', async () => {
    getDbMock.mockReturnValue(
      fakeDb([
        user('I started bouldering'),
        proposalStep('p1', PROPOSED),
        assistant('I would store these'),
        user('what is on my list for next week?'),
        assistant('Nothing'),
        user('yes'),
      ]),
    )
    await expect(
      runStoreThoughtsTool(ctx(turn({ proposalReply: 'confirm' })), { proposal_id: 'p1' }),
    ).rejects.toThrow(/no open proposal/)
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('rejects a superseded proposal id: only the latest proposal can be stored', async () => {
    getDbMock.mockReturnValue(
      fakeDb([
        user('a'),
        proposalStep('p1', ['old text']),
        assistant('store?'),
        user('change it'),
        proposalStep('p2', ['new text']),
        assistant('store this?'),
        user('yes'),
      ]),
    )
    await expect(
      runStoreThoughtsTool(ctx(turn({ proposalReply: 'confirm' })), { proposal_id: 'p1' }),
    ).rejects.toThrow(/does not match/)
    expect(captureThoughtMock).not.toHaveBeenCalled()

    // the latest one stores, with ITS persisted text
    await runStoreThoughtsTool(ctx(turn({ proposalReply: 'confirm' })), { proposal_id: 'p2' })
    expect(captureThoughtMock.mock.calls.map((c) => c[1])).toEqual(['new text'])
  })

  it('never takes text from the model: a thoughts argument is refused, the persisted text is stored', async () => {
    getDbMock.mockReturnValue(fakeDb(confirmSession('p1')))
    await expect(
      runStoreThoughtsTool(ctx(turn({ proposalReply: 'confirm' })), {
        proposal_id: 'p1',
        thoughts: ['something the user never approved'],
      }),
    ).rejects.toThrow(/Unknown argument: thoughts/)
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('validates the proposal id and the Ask context', async () => {
    getDbMock.mockReturnValue(fakeDb(confirmSession('p1')))
    const c = ctx(turn({ proposalReply: 'confirm' }))
    await expect(runStoreThoughtsTool(c, {})).rejects.toThrow(/proposal_id/)
    await expect(runStoreThoughtsTool(c, { proposal_id: '  ' })).rejects.toThrow(/proposal_id/)
    await expect(runStoreThoughtsTool(c, { proposal_id: 'a b' })).rejects.toThrow(/whitespace/)
    await expect(runStoreThoughtsTool(ctx(undefined), { proposal_id: 'p1' })).rejects.toThrow(
      /only available in an Ask chat turn/,
    )
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('stores a proposal at most once per turn (a repeated call is refused)', async () => {
    getDbMock.mockReturnValue(fakeDb(confirmSession('p1')))
    const c = ctx(turn({ proposalReply: 'confirm' }))
    await runStoreThoughtsTool(c, { proposal_id: 'p1' })
    await expect(runStoreThoughtsTool(c, { proposal_id: 'p1' })).rejects.toThrow(/already ran/)
    expect(captureThoughtMock).toHaveBeenCalledTimes(2)
  })

  it('a failure part-way says how many were stored and blocks any retry (no double store)', async () => {
    getDbMock.mockReturnValue(fakeDb(confirmSession('p1')))
    captureThoughtMock.mockReset()
    captureThoughtMock
      .mockResolvedValueOnce({ id: 't1' })
      .mockRejectedValueOnce(new Error('db down'))
    const c = ctx(turn({ proposalReply: 'confirm' }))

    await expect(runStoreThoughtsTool(c, { proposal_id: 'p1' })).rejects.toThrow(
      /Stored 1 of 2 thoughts.*db down/,
    )
    await expect(runStoreThoughtsTool(c, { proposal_id: 'p1' })).rejects.toThrow(/already ran/)
    expect(captureThoughtMock).toHaveBeenCalledTimes(2)
  })
})
