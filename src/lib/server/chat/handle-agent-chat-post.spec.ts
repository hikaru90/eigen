import { beforeEach, describe, expect, it, vi } from 'vitest'

const { agentChatMock, dbWrites } = vi.hoisted(() => ({
  agentChatMock: vi.fn(),
  dbWrites: [] as Array<{ values: Record<string, unknown> }>,
}))

vi.mock('$lib/server/llm/agent-loop', () => ({ agentChat: agentChatMock }))
vi.mock('$lib/server/db', () => {
  // chat_message history is empty; every insert is recorded in order
  const scoped = {
    select: () => ({
      from: () => ({
        where: (): unknown => ({
          orderBy: async () => [],
          then: (resolve: (v: unknown) => unknown) => resolve([{ count: 1 }]),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        dbWrites.push({ values })
        return { returning: async () => [{ id: `msg-${dbWrites.length}` }] }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return {
    getDb: () => scoped,
    appDbAsyncLocal: { run: (_db: unknown, fn: () => unknown) => fn() },
    appSql: { reserve: async () => ({ release: async () => undefined }) },
    createScopedDrizzle: () => scoped,
    activateTenantDbSession: async () => undefined,
    deactivateTenantDbSession: async () => undefined,
  }
})

import { InsufficientCreditsError } from '$lib/server/billing/wallet'
import {
  BRIEFING_BOOTSTRAP_MESSAGES,
  chatErrorTerminalPayload,
  failedAssistantTurn,
  handleAgentChatPost,
} from './handle-agent-chat-post'

async function streamedTurn(body: Record<string, unknown>) {
  const event = {
    locals: { user: { id: 'u1' } },
    request: {
      headers: new Headers({ accept: 'application/x-ndjson' }),
      signal: new AbortController().signal,
    },
  }
  const res = await handleAgentChatPost(event as never, body, {
    sessionMode: 'default',
    resolveAgentUserMessage: ({ message }) => message,
  } as never)
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
  return lines as Array<Record<string, unknown>>
}

describe('handleAgentChatPost streaming — Ask proposes thoughts', () => {
  beforeEach(() => {
    agentChatMock.mockReset()
    dbWrites.length = 0
  })

  it('runs the agent on the user session and stores the proposal tool step and the answer with its appendix', async () => {
    const preview = JSON.stringify({ proposalId: 'p1', thoughts: ['Started bouldering'] })
    agentChatMock.mockImplementation(async (input: { onEvent: (e: unknown) => void }) => {
      input.onEvent({ type: 'tool_call', tool: 'propose_thoughts', arguments: { thoughts: ['Started bouldering'] } })
      input.onEvent({ type: 'tool_result', tool: 'propose_thoughts', preview })
      return { response: 'Noted.', appendix: 'LEAD\n\n1. Started bouldering', messages: [] }
    })

    const lines = await streamedTurn({ message: 'I started bouldering', sessionId: '' })

    expect(agentChatMock.mock.calls[0]![0].chatSessionId).toEqual(expect.any(String))
    const stepWrite = dbWrites.find((w) => w.values.role === 'assistant' && w.values.content === preview)
    expect(stepWrite?.values.metadata).toMatchObject({ variant: 'tool_step', tool: 'propose_thoughts' })
    const done = lines.find((l) => l.type === 'done')
    expect(done?.response).toBe('Noted.\n\nLEAD\n\n1. Started bouldering')
    expect(
      dbWrites.some((w) => w.values.role === 'assistant' && w.values.content === done?.response),
    ).toBe(true)
  })

  it('a briefing bootstrap turn never opens the Ask proposal flow', async () => {
    agentChatMock.mockResolvedValue({ response: 'Good morning.', messages: [] })

    await streamedTurn({ bootstrap: true, briefingPeriod: 'morning', sessionId: '' })

    expect(agentChatMock.mock.calls[0]![0].chatSessionId).toBeUndefined()
  })
})

describe('chatErrorTerminalPayload', () => {
  it('includes insufficient_credits code for InsufficientCreditsError', () => {
    const err = new InsufficientCreditsError({
      phase: 'precheck',
      availableCredits: 10,
      requiredCredits: 50,
    })
    const payload = chatErrorTerminalPayload(err, [err.message])
    expect(payload.type).toBe('error')
    expect(payload.code).toBe('insufficient_credits')
    expect(payload.availableCredits).toBe(10)
    expect(payload.requiredCredits).toBe(50)
  })

  it('returns generic error payload for other failures', () => {
    const payload = chatErrorTerminalPayload(new Error('boom'), ['boom'])
    expect(payload).toEqual({ type: 'error', error: 'boom', details: ['boom'] })
  })
})

describe('BRIEFING_BOOTSTRAP_MESSAGES', () => {
  it('covers morning, evening, and weekly periods', () => {
    expect(Object.keys(BRIEFING_BOOTSTRAP_MESSAGES).sort()).toEqual([
      'evening',
      'morning',
      'weekly',
    ])
  })

  it('never references removed list_temporal_events', () => {
    for (const [period, message] of Object.entries(BRIEFING_BOOTSTRAP_MESSAGES)) {
      expect(message, period).not.toMatch(/list_temporal_events/)
      expect(message, period).not.toMatch(/manage_temporal_event/)
    }
  })

  it('points the agent at available project and Q&A tools', () => {
    for (const [period, message] of Object.entries(BRIEFING_BOOTSTRAP_MESSAGES)) {
      expect(message, period).toMatch(/list_projects/)
      expect(message, period).toMatch(/get_project_timeline|answer_question|retrieve_thoughts/)
    }
  })
})

describe('failedAssistantTurn', () => {
  it('records a failed run as an assistant error turn, so history never shows a bare question', () => {
    expect(failedAssistantTurn({ type: 'error', error: 'Model timed out' })).toEqual({
      content: 'Model timed out',
      metadata: { variant: 'error' },
    })
  })

  it('keeps the credits code for the UI', () => {
    expect(
      failedAssistantTurn({ type: 'error', error: 'Not enough credits', code: 'insufficient_credits' }),
    ).toEqual({ content: 'Not enough credits', metadata: { variant: 'error', code: 'insufficient_credits' } })
  })
})
