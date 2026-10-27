import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The whole Ask proposes-thoughts flow across turns, with only the outside world faked: the
 * model (llm-client), Jev (decision-plane), the capture pipeline (captureThought) and the
 * database (an in-memory chat_message store). Everything between is real: runAskTurn →
 * agentChat → the real tool registry → the AP-4 guard → captureThought.
 */

const { llmMock, decisionsMock, captureThoughtMock, rowsRef } = vi.hoisted(() => ({
  llmMock: vi.fn(),
  decisionsMock: vi.fn(),
  captureThoughtMock: vi.fn(),
  rowsRef: {
    rows: [] as Array<{ role: string; content: string; metadata: unknown }>,
  },
}))

vi.mock('$lib/paraglide/messages.js', () => ({
  m: {
    ask_proposal_lead_in: () => 'LEAD',
    ask_proposal_footer: () => 'FOOT',
    ask_capture_check_failed: () => 'NOTE capture check failed',
    ask_reply_check_failed: () => 'NOTE reply check failed',
    ask_proposal_missing: () => 'NOTE proposal missing',
    ask_store_missing: () => 'NOTE store missing',
  },
}))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))
// no env-gated Jev kinds in this flow, whatever the local .env says
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return { ...actual, resolveDecisionEnforceKinds: () => new Set() }
})
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: decisionsMock }
})
vi.mock('$lib/server/capture/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/capture/service')>()
  return { ...actual, captureThought: captureThoughtMock }
})
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: vi.fn(async () => undefined) }))
vi.mock('$lib/server/db', () => ({ getDb: () => memoryChatDb() }))

import { runAskTurn } from './run-ask-turn'

/** chat_message as an in-memory table: inserts append, the guard/history selects read in order. */
function memoryChatDb() {
  return {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: (): unknown => {
          if ('count' in fields) {
            return Promise.resolve([{ count: rowsRef.rows.length }])
          }
          return { orderBy: async () => rowsRef.rows.map((r) => ({ ...r })) }
        },
      }),
    }),
    insert: () => ({
      values: (v: { role: string; content: string; metadata?: unknown }) => {
        rowsRef.rows.push({ role: v.role, content: v.content, metadata: v.metadata ?? null })
        return { returning: async () => [{ id: `m${rowsRef.rows.length}` }] }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
}

const llmJson = (payload: unknown) => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
})
const choice = (value: string) => ({
  type: 'choice' as const,
  choice: value,
  probabilities: { [value]: 0.9 },
  confidence: 0.9,
})
function jev(captureWorthy: string, proposalReply?: string) {
  const answers = new Map([['capture_worthy', choice(captureWorthy)]])
  if (proposalReply) answers.set('proposal_reply', choice(proposalReply))
  decisionsMock.mockResolvedValueOnce(answers)
}

const PROPOSED = ['Started bouldering on Tuesdays with Jonas', 'Wants a rest day on Wednesday']

async function turn(message: string) {
  return runAskTurn({
    db: memoryChatDb() as never,
    userId: 'u1',
    sessionId: 's1',
    message,
  })
}

/** Turn one: a statement Jev finds worth keeping → the model proposes it. */
async function proposeTurn() {
  jev('yes')
  llmMock
    .mockResolvedValueOnce(llmJson({ tool: 'propose_thoughts', arguments: { thoughts: PROPOSED } }))
    .mockResolvedValueOnce(llmJson({ answer: 'Noted.' }))
  return turn('I started bouldering on Tuesdays with Jonas and want Wednesdays off')
}

describe('Ask proposes thoughts — turn flow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    rowsRef.rows = []
    llmMock.mockReset()
    decisionsMock.mockReset()
    captureThoughtMock.mockReset()
    let n = 0
    captureThoughtMock.mockImplementation(async () => ({ id: `thought-${++n}` }))
  })

  it('AC-1/AC-2: propose in plain text (nothing stored), then "yes" stores exactly the proposed texts', async () => {
    const first = await proposeTurn()

    expect(first.answer).toBe(`Noted.\n\nLEAD\n\n1. ${PROPOSED[0]}\n2. ${PROPOSED[1]}\n\nFOOT`)
    expect(captureThoughtMock).not.toHaveBeenCalled()
    // the proposal is a persisted tool step — the only place it lives
    expect(
      rowsRef.rows.some(
        (r) =>
          (r.metadata as { tool?: string } | null)?.tool === 'propose_thoughts' &&
          r.content.includes(PROPOSED[0]!),
      ),
    ).toBe(true)

    // the model re-sends nothing: it only names the proposal id it was given
    const proposalId = (
      JSON.parse(
        rowsRef.rows.find(
          (r) => (r.metadata as { tool?: string } | null)?.tool === 'propose_thoughts',
        )!.content,
      ) as { proposalId: string }
    ).proposalId
    jev('no', 'confirm')
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'store_thoughts', arguments: { proposal_id: proposalId } }),
      )
      .mockResolvedValueOnce(llmJson({ answer: 'Stored.' }))

    const second = await turn('yes')

    expect(second.toolCalls.map((c) => c.tool)).toEqual(['store_thoughts'])
    expect(second.toolCalls[0]!.failed).toBe(false)
    expect(captureThoughtMock.mock.calls.map((c) => c[1])).toEqual(PROPOSED)
    for (const call of captureThoughtMock.mock.calls) {
      expect(call[2]).toMatchObject({
        source: 'ask',
        provenance: { askSessionId: 's1', askProposalId: proposalId },
      })
    }
    expect(second.answer).toBe('Stored.')
  })

  it('AC-4: a later "yes" cannot store the old proposal — it is not even offered to Jev, and the tool refuses', async () => {
    await proposeTurn()
    const proposalId = (
      JSON.parse(
        rowsRef.rows.find(
          (r) => (r.metadata as { tool?: string } | null)?.tool === 'propose_thoughts',
        )!.content,
      ) as { proposalId: string }
    ).proposalId

    // an unrelated turn in between closes the proposal; even if the model tries to store, it is refused
    jev('no', 'unrelated')
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'store_thoughts', arguments: { proposal_id: proposalId } }),
      )
      .mockResolvedValueOnce(llmJson({ answer: 'Nothing stored.' }))
    const between = await turn("what's on my list for next week?")
    expect(captureThoughtMock).not.toHaveBeenCalled()
    expect(between.toolCalls).toMatchObject([{ tool: 'store_thoughts', failed: true }])

    // the late "yes": the proposal is two user turns away, so no reply question is asked at all
    // (and a wrong confirm from Jev would still be refused by the tool: see ask-proposal-tools.spec)
    jev('no', 'confirm')
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'store_thoughts', arguments: { proposal_id: proposalId } }),
      )
      .mockResolvedValue(llmJson({ answer: 'ok' }))
    const late = await turn('yes')

    expect(captureThoughtMock).not.toHaveBeenCalled()
    expect(late.toolCalls).toMatchObject([{ tool: 'store_thoughts', failed: true }])
    expect(late.answer).toBe('ok')
    const lateSpecs = (decisionsMock.mock.calls.at(-1)![0] as { specs: Array<{ id: string }> })
      .specs
    expect(lateSpecs.map((spec) => spec.id)).toEqual(['capture_worthy'])
  })

  it('AC-6: a store call with no confirmed open proposal is rejected and stores nothing', async () => {
    jev('no')
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'store_thoughts', arguments: { proposal_id: 'made-up' } }),
      )
      .mockResolvedValueOnce(llmJson({ answer: 'I could not store that.' }))

    const result = await turn('what is on my list?')

    expect(captureThoughtMock).not.toHaveBeenCalled()
    expect(result.toolCalls).toEqual([
      { tool: 'store_thoughts', arguments: { proposal_id: 'made-up' }, failed: true },
    ])
    expect(result.answer).toBe('I could not store that.')
  })

  it('AC-3: a revise reply shows a replacement proposal; only a later confirm stores that one', async () => {
    await proposeTurn()
    const REVISED = ['Started bouldering on Tuesdays with Jonas', 'Wants a rest day on Thursday']

    jev('no', 'revise')
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'propose_thoughts', arguments: { thoughts: REVISED } }),
      )
      .mockResolvedValueOnce(llmJson({ answer: 'Changed it.' }))
    const revised = await turn('the second one is wrong, it is Thursdays')

    expect(captureThoughtMock).not.toHaveBeenCalled()
    expect(revised.answer).toContain(`2. ${REVISED[1]}`)

    const latest = rowsRef.rows
      .filter((r) => (r.metadata as { tool?: string } | null)?.tool === 'propose_thoughts')
      .map((r) => JSON.parse(r.content) as { proposalId: string; thoughts: string[] })
      .at(-1)!
    expect(latest.thoughts).toEqual(REVISED)

    jev('no', 'confirm')
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'store_thoughts', arguments: { proposal_id: latest.proposalId } }),
      )
      .mockResolvedValueOnce(llmJson({ answer: 'Stored.' }))
    await turn('yes')

    expect(captureThoughtMock.mock.calls.map((c) => c[1])).toEqual(REVISED)
  })

  it('AC-7: when Jev is down the reply says so, still answers, and nothing is proposed or stored', async () => {
    decisionsMock.mockRejectedValueOnce(new Error('decisions api down'))
    llmMock
      .mockResolvedValueOnce(
        llmJson({ tool: 'propose_thoughts', arguments: { thoughts: ['should not be possible'] } }),
      )
      .mockResolvedValueOnce(llmJson({ answer: 'Here is my answer.' }))

    const result = await turn('I started bouldering, what should I plan?')

    expect(result.answer).toBe('Here is my answer.\n\nNOTE capture check failed')
    expect(result.toolCalls[0]).toMatchObject({ tool: 'propose_thoughts', failed: true })
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })
})
