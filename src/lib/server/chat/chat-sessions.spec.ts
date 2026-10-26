import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: [] as unknown[],
  messages: [] as unknown[],
  resolveMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => m.session,
          orderBy: async () => m.messages,
        }),
      }),
    }),
  }),
}))
vi.mock('$lib/server/facts/secure-values', () => ({ resolveSecureReferences: m.resolveMock }))

import { loadChatSession } from './chat-sessions'

const SECURE_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = `[secure:${SECURE_ID}]`

function row(id: string, role: string, content: string, metadata: unknown = null) {
  return { id, role, content, metadata, createdAt: new Date('2026-06-01T00:00:00Z') }
}

beforeEach(() => {
  m.resolveMock.mockReset()
  m.resolveMock.mockImplementation(async (_userId: string, text: string) =>
    text.split(TOKEN).join('B-XY 4711'),
  )
  m.session = [{ id: 's1', title: 'Plates' }]
  m.messages = []
})

describe('loadChatSession (display read of a stored conversation)', () => {
  it('is null for a session that does not exist', async () => {
    m.session = []
    expect(await loadChatSession('missing', 'u1')).toBeNull()
  })

  it("shows the user the value for the assistant's stored answers; the stored rows keep only the token", async () => {
    const stored = row('m2', 'assistant', `Your licence plate is ${TOKEN}.`)
    m.messages = [row('m1', 'user', "what's my licence plate?"), stored]

    const loaded = await loadChatSession('s1', 'u1')

    expect(loaded!.messages.map((x) => x.content)).toEqual([
      "what's my licence plate?",
      'Your licence plate is B-XY 4711.',
    ])
    expect(m.resolveMock).toHaveBeenCalledTimes(1)
    expect(m.resolveMock).toHaveBeenCalledWith('u1', `Your licence plate is ${TOKEN}.`)
    // the stored row object is not mutated
    expect(stored.content).toContain(TOKEN)
  })

  it('leaves tool steps, thinking and error rows as stored (only final answers are resolved)', async () => {
    m.messages = [
      row('m1', 'assistant', `{"answer":"${TOKEN}"}`, {
        variant: 'tool_result',
        tool: 'answer_question',
      }),
      row('m2', 'assistant', `thinking ${TOKEN}`, { variant: 'thinking' }),
      row('m3', 'assistant', 'failed', { variant: 'error' }),
    ]
    const loaded = await loadChatSession('s1', 'u1')
    expect(loaded!.messages.map((x) => x.content)).toEqual([
      `{"answer":"${TOKEN}"}`,
      `thinking ${TOKEN}`,
      'failed',
    ])
    expect(m.resolveMock).not.toHaveBeenCalled()
  })

  it('never resolves what the user typed', async () => {
    m.messages = [row('m1', 'user', `my plate is ${TOKEN}`)]
    const loaded = await loadChatSession('s1', 'u1')
    expect(loaded!.messages[0]!.content).toBe(`my plate is ${TOKEN}`)
    expect(m.resolveMock).not.toHaveBeenCalled()
  })
})
