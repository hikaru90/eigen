import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatMessage, chatSession } from '$lib/server/db/brain.schema'

const { agentChatMock } = vi.hoisted(() => ({ agentChatMock: vi.fn() }))

vi.mock('$lib/server/llm/agent-loop', () => ({ agentChat: agentChatMock }))

import { finalAnswerText, runAskTurn } from './run-ask-turn'

type Write = { table: unknown; values?: Record<string, unknown>; set?: Record<string, unknown> }

/** Records every write in order; select(count) and select(history) answer from the given rows. */
function fakeDb(priorRows: Array<{ role: string; content: string; metadata: unknown }>) {
  const writes: Write[] = []
  let messageIdSeq = 0
  const db = {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: (): unknown => {
          if ('count' in fields) {
            const storedUserMessages = writes.filter(
              (w) => w.table === chatMessage && w.values?.role === 'user',
            ).length
            return Promise.resolve([{ count: priorRows.length + storedUserMessages }])
          }
          return { orderBy: async () => priorRows }
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ table, values })
        const id = `msg-${++messageIdSeq}`
        return { returning: async () => [{ id }] }
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          writes.push({ table, set })
        },
      }),
    }),
  }
  return { db: db as never, writes }
}

describe('runAskTurn', () => {
  beforeEach(() => {
    agentChatMock.mockReset()
  })

  it('stores the user message, runs the agent on history + message, then stores the answer', async () => {
    agentChatMock.mockResolvedValue({
      response: 'You noted mirin.',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: '{"answer":"earlier answer"}' },
        { role: 'user', content: 'what did I note about mirin?' },
      ],
    })
    const { db, writes } = fakeDb([
      { role: 'user', content: 'earlier question', metadata: null },
      { role: 'assistant', content: 'earlier answer', metadata: null },
    ])

    const result = await runAskTurn({
      db,
      userId: 'u1',
      sessionId: 's1',
      message: 'what did I note about mirin?',
    })

    // history is read BEFORE the new message is stored, so it excludes the current turn
    const agentInput = agentChatMock.mock.calls[0]![0]
    expect(agentInput.userId).toBe('u1')
    expect(agentInput.aiSessionId).toBe('s1')
    expect(agentInput.db).toBe(db)
    expect(agentInput.messages.at(-1)).toEqual({
      role: 'user',
      content: 'what did I note about mirin?',
    })
    expect(
      agentInput.messages.filter(
        (m: { content: string }) => m.content === 'what did I note about mirin?',
      ),
    ).toHaveLength(1)

    const messageWrites = writes.filter((w) => w.table === chatMessage)
    expect(messageWrites.map((w) => [w.values?.role, w.values?.content])).toEqual([
      ['user', 'what did I note about mirin?'],
      ['assistant', 'You noted mirin.'],
    ])
    expect(messageWrites.every((w) => w.values?.sessionId === 's1' && w.values?.userId === 'u1')).toBe(
      true,
    )
    expect(result.answer).toBe('You noted mirin.')
    expect(result.messageId).toBe('msg-2')
    expect(result.toolCalls).toEqual([])
  })

  it('reports the tool calls the agent made, in order, with failures marked', async () => {
    agentChatMock.mockImplementation(async (input: { onEvent: (e: unknown) => void }) => {
      input.onEvent({
        type: 'tool_call',
        tool: 'capture_thought',
        arguments: { raw: 'I am vegetarian', as_user: true },
      })
      input.onEvent({ type: 'tool_result', tool: 'capture_thought', preview: 'ok' })
      input.onEvent({ type: 'tool_call', tool: 'delete_thought', arguments: { thought_id: 't1' } })
      input.onEvent({ type: 'tool_result', tool: 'delete_thought', preview: 'boom', failed: true })
      return { response: 'Done.', messages: [] }
    })
    const { db } = fakeDb([])

    const result = await runAskTurn({ db, userId: 'u1', sessionId: 's1', message: 'hi' })

    expect(result.toolCalls).toEqual([
      { tool: 'capture_thought', arguments: { raw: 'I am vegetarian', as_user: true }, failed: false },
      { tool: 'delete_thought', arguments: { thought_id: 't1' }, failed: true },
    ])
  })

  it('forwards agent events to the caller', async () => {
    const seen: unknown[] = []
    agentChatMock.mockImplementation(async (input: { onEvent: (e: unknown) => void }) => {
      input.onEvent({ type: 'thinking', content: 'hmm' })
      return { response: 'Done.', messages: [] }
    })
    const { db } = fakeDb([])
    await runAskTurn({
      db,
      userId: 'u1',
      sessionId: 's1',
      message: 'hi',
      onEvent: (e) => seen.push(e),
    })
    expect(seen).toEqual([{ type: 'thinking', content: 'hmm' }])
  })

  it('titles the session from the first message only', async () => {
    agentChatMock.mockResolvedValue({ response: 'A.', messages: [] })
    const long = 'x'.repeat(100)

    const first = fakeDb([])
    await runAskTurn({ db: first.db, userId: 'u1', sessionId: 's1', message: long })
    const titleWrite = first.writes.find((w) => w.table === chatSession)
    expect(titleWrite?.set).toEqual({ title: `${'x'.repeat(77)}...` })

    const later = fakeDb([{ role: 'user', content: 'before', metadata: null }])
    await runAskTurn({ db: later.db, userId: 'u1', sessionId: 's1', message: 'second' })
    expect(later.writes.find((w) => w.table === chatSession)).toBeUndefined()
  })

  it('does not store intermediate steps unless persistSteps is set', async () => {
    const run = async (persistSteps: boolean | undefined) => {
      agentChatMock.mockImplementation(async (input: { onEvent: (e: unknown) => void }) => {
        input.onEvent({ type: 'tool_call', tool: 'answer_question', arguments: { question: 'q' } })
        input.onEvent({ type: 'tool_result', tool: 'answer_question', preview: 'p' })
        return { response: 'Answer.', messages: [] }
      })
      const { db, writes } = fakeDb([])
      await runAskTurn({
        db,
        userId: 'u1',
        sessionId: 's1',
        message: 'q',
        ...(persistSteps === undefined ? {} : { persistSteps }),
      })
      return writes.filter((w) => w.table === chatMessage && w.values?.role === 'assistant')
    }

    expect(await run(undefined)).toHaveLength(1)
    const withSteps = await run(true)
    expect(withSteps.length).toBeGreaterThan(1)
    expect(withSteps.at(-1)?.values?.content).toBe('Answer.')
  })

  it('a bootstrap prompt reaches the agent but is neither stored as a user message nor a title', async () => {
    agentChatMock.mockResolvedValue({ response: 'Good morning.', messages: [] })
    const { db, writes } = fakeDb([])

    await runAskTurn({
      db,
      userId: 'u1',
      sessionId: 's1',
      message: 'Give my morning briefing',
      bootstrap: true,
    })

    expect(agentChatMock.mock.calls[0]![0].messages.at(-1)).toEqual({
      role: 'user',
      content: 'Give my morning briefing',
    })
    expect(
      writes.filter((w) => w.table === chatMessage && w.values?.role === 'user'),
    ).toHaveLength(0)
    expect(writes.find((w) => w.table === chatSession)).toBeUndefined()
  })

  it('rejects a blank message before touching the database or the agent', async () => {
    const { db, writes } = fakeDb([])
    await expect(
      runAskTurn({ db, userId: 'u1', sessionId: 's1', message: '   ' }),
    ).rejects.toThrow(/message is required/)
    expect(writes).toEqual([])
    expect(agentChatMock).not.toHaveBeenCalled()
  })

  it('an agent failure propagates; the stored user message stays and no answer is stored', async () => {
    agentChatMock.mockRejectedValue(new Error('model timed out'))
    const { db, writes } = fakeDb([])

    await expect(
      runAskTurn({ db, userId: 'u1', sessionId: 's1', message: 'hi' }),
    ).rejects.toThrow('model timed out')

    expect(
      writes.filter((w) => w.table === chatMessage).map((w) => w.values?.role),
    ).toEqual(['user'])
  })

  it('hands the agent the session for a user turn but not for a bootstrap prompt (no proposals on briefings)', async () => {
    agentChatMock.mockResolvedValue({ response: 'A.', messages: [] })

    await runAskTurn({ db: fakeDb([]).db, userId: 'u1', sessionId: 's1', message: 'hi' })
    expect(agentChatMock.mock.calls[0]![0].chatSessionId).toBe('s1')

    await runAskTurn({
      db: fakeDb([]).db,
      userId: 'u1',
      sessionId: 's1',
      message: 'Give my morning briefing',
      bootstrap: true,
    })
    expect(agentChatMock.mock.calls[1]![0].chatSessionId).toBeUndefined()
  })

  it('always stores the propose/store tool steps (the proposal lives there), and only those unless persistSteps', async () => {
    const preview = JSON.stringify({ proposalId: 'p1', thoughts: ['Started bouldering'] })
    agentChatMock.mockImplementation(async (input: { onEvent: (e: unknown) => void }) => {
      input.onEvent({ type: 'thinking', content: 'hmm' })
      input.onEvent({ type: 'tool_call', tool: 'answer_question', arguments: { question: 'q' } })
      input.onEvent({ type: 'tool_result', tool: 'answer_question', preview: 'p' })
      input.onEvent({
        type: 'tool_call',
        tool: 'propose_thoughts',
        arguments: { thoughts: ['Started bouldering'] },
      })
      input.onEvent({ type: 'tool_executing', tool: 'propose_thoughts' })
      input.onEvent({ type: 'tool_result', tool: 'propose_thoughts', preview })
      return { response: 'The answer.', appendix: 'LEAD\n\n1. Started bouldering', messages: [] }
    })
    const { db, writes } = fakeDb([])

    await runAskTurn({ db, userId: 'u1', sessionId: 's1', message: 'q' })

    const assistantWrites = writes
      .filter((w) => w.table === chatMessage && w.values?.role === 'assistant')
      .map((w) => w.values!)
    expect(assistantWrites).toHaveLength(2)
    expect(assistantWrites[0]).toMatchObject({
      content: preview,
      metadata: { variant: 'tool_step', tool: 'propose_thoughts', failed: false },
    })
    expect(assistantWrites[1]!.content).toBe('The answer.\n\nLEAD\n\n1. Started bouldering')
  })

  it('returns the stored answer with the appendix (proposal block / notes) after the answer', async () => {
    agentChatMock.mockResolvedValue({
      response: 'You prefer sourdough.',
      appendix: 'NOTE',
      messages: [],
    })
    const { db } = fakeDb([])
    const result = await runAskTurn({ db, userId: 'u1', sessionId: 's1', message: 'bread?' })
    expect(result.answer).toBe('You prefer sourdough.\n\nNOTE')
  })
})

describe('finalAnswerText with an appendix', () => {
  it('appends after the answer_question answer, which would otherwise replace the agent response', () => {
    const steps = [
      {
        content: JSON.stringify({ answer: 'Answer: Rest on Saturday.\nEvidence:\n- none\nUnknown:\n- none' }),
        metadata: { variant: 'tool_result', tool: 'answer_question' },
      },
    ]
    expect(finalAnswerText('ignored', steps, 'LEAD\n\n1. x')).toBe(
      'Rest on Saturday.\n\nLEAD\n\n1. x',
    )
  })

  it('leaves the answer untouched without an appendix, and the appendix is trusted text (not sanitised away)', () => {
    expect(finalAnswerText('Plain answer.', [])).toBe('Plain answer.')
    expect(finalAnswerText('Plain answer.', [], '')).toBe('Plain answer.')
    expect(finalAnswerText('Plain answer.', [], '[1] raw-looking but ours')).toBe(
      'Plain answer.\n\n[1] raw-looking but ours',
    )
  })
})
