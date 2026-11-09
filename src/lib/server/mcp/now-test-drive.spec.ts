/**
 * The agent test-drive of the Lightning questions (docs/testing/agent-benchmark.md, the DoD gate;
 * docs/planning/feature-mesh-now.md §7): an MCP client drives `get_now_cards` and
 * `answer_now_card` through the real MCP server layer (the SDK Server and Client over an
 * in-memory transport, the real registry, real argument checks, real result sanitising) and the
 * real decisions behind them (`resolveNowDeck`, `runNowAnswer`). Nothing touches a network or a
 * database: the stores, the deck writer ("the LLM") and the thought and project writes are
 * in-memory fakes.
 *
 * Budget: get_now_cards + answer_now_card = 2 tool calls for the happy path. Reads that verify
 * and the cleanup are not part of that budget.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Kind = 'do' | 'sort' | 'file' | 'unblock'

type FakeThought = {
  id: string
  userId: string
  text: string
  category: string
  lifecycle: 'open' | 'completed' | 'archived'
  /** A `file` card is written for it, proposing this project. */
  fileTo?: string
}

type FakeProject = {
  id: string
  userId: string
  label: string
  status: 'active' | 'someday' | 'completed'
  nextActionThoughtId: string | null
  /** The step an `unblock` card suggests for it. */
  suggestedStep: string
}

type FakeCard = {
  id: string
  userId: string
  deckNumber: number
  position: number
  kind: Kind
  status: 'pending' | 'answered' | 'superseded'
  targetThoughtId: string | null
  targetProjectEntityId: string | null
  payload: {
    text: string
    why: string
    suggestedStep: string | null
    notTaskCategory: string | null
    candidatesOmitted: number
  }
  answer: string | null
}

const world = vi.hoisted(() => ({
  thoughts: new Map<string, unknown>(),
  projects: new Map<string, unknown>(),
  cards: [] as unknown[],
  llmCalls: 0,
  memberships: [] as Array<{ projectId: string; thoughtId: string }>,
}))

const thoughts = () => world.thoughts as Map<string, FakeThought>
const projects = () => world.projects as Map<string, FakeProject>
const cards = () => world.cards as FakeCard[]

vi.mock('$lib/server/db', () => ({
  getDb: () => {
    throw new Error('the test-drive must not reach the database')
  },
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: async () => 'enc',
  decryptTenantValue: async () => '{}',
}))
vi.mock('./../mesh/now-answer-deps', () => ({
  buildNowAnswerDeps: () => {
    throw new Error('the test-drive wires its own answer deps')
  },
  buildNowUndoDeps: () => {
    throw new Error('the test-drive wires its own undo deps')
  },
}))

// The read: the real decisions (`resolveNowDeck`, `resolveNow`) over in-memory stores.
function storeDeps(userId: string, actual: typeof import('$lib/server/mesh/now-store')) {
  const mine = () => cards().filter((c) => c.userId === userId)
  const view = (card: FakeCard) => ({
    id: card.id,
    kind: card.kind,
    position: card.position,
    targetThoughtId: card.targetThoughtId,
    targetProjectEntityId: card.targetProjectEntityId,
    payloadEncrypted: card.id,
  })
  return {
    expireEarlier: async () => undefined,
    readToday: async () => {
      const decks = new Set(mine().map((c) => c.deckNumber))
      const latest = Math.max(0, ...decks)
      return {
        deckCount: decks.size,
        pending: mine()
          .filter((c) => c.deckNumber === latest && c.status === 'pending')
          .sort((a, b) => a.position - b.position)
          .map(view),
      }
    },
    isStale: async (stored: { targetThoughtId: string | null; targetProjectEntityId: string | null; kind: Kind }) => {
      if (stored.targetThoughtId && thoughts().get(stored.targetThoughtId)?.lifecycle !== 'open') return true
      if (stored.kind === 'unblock' && stored.targetProjectEntityId) {
        const project = projects().get(stored.targetProjectEntityId)
        if (!project || project.status !== 'active' || project.nextActionThoughtId) return true
      }
      return false
    },
    markSuperseded: async (cardId: string) => {
      const card = cards().find((c) => c.id === cardId)
      if (card) card.status = 'superseded'
    },
    loadCandidates: async () => ({
      thoughts: [...thoughts().values()]
        .filter((t) => t.userId === userId && t.lifecycle === 'open' && t.category === 'task')
        .map((t) => ({
          thoughtId: t.id,
          category: t.category,
          snippet: t.text,
          author: 'user' as const,
          createdAt: '2026-10-01T10:00:00.000Z',
          project: null,
          eventAt: null,
          skipCount: 0,
        })),
      projects: [...projects().values()]
        .filter((p) => p.userId === userId && p.status === 'active' && !p.nextActionThoughtId)
        .map((p) => ({
          entityId: p.id,
          label: p.label,
          deadline: null,
          milestones: [],
          nextAction: null,
          openTaskCount: 0,
          stalledReason: null,
        })),
      candidatesOmitted: 0,
    }),
    loadContext: async (candidates: unknown) => ({ candidates }),
    // "The LLM": one deterministic call per deck, and a counter so the test sees how often it ran.
    generate: async (context: { candidates: { thoughts: Array<{ thoughtId: string }>; projects: Array<{ entityId: string }> } }) => {
      world.llmCalls += 1
      return [
        ...context.candidates.thoughts.map((c) => {
          const t = thoughts().get(c.thoughtId) as FakeThought
          return t.fileTo
            ? {
                kind: 'file' as const,
                thoughtId: t.id,
                projectEntityId: t.fileTo,
                text: `File "${t.text}" under ${projects().get(t.fileTo)?.label}?`,
                why: 'It sounds like that project.',
                suggestedStep: null,
                notTaskCategory: 'note',
              }
            : {
                kind: 'do' as const,
                thoughtId: t.id,
                projectEntityId: null,
                text: t.text,
                why: 'It has been open a while.',
                suggestedStep: null,
                notTaskCategory: null,
              }
        }),
        ...context.candidates.projects.map((c) => {
          const p = projects().get(c.entityId) as FakeProject
          return {
            kind: 'unblock' as const,
            thoughtId: null,
            projectEntityId: p.id,
            text: `${p.label} has no next step.`,
            why: 'Nothing is marked next.',
            suggestedStep: p.suggestedStep,
            notTaskCategory: null,
          }
        }),
      ]
    },
    writeDeck: async (deckNumber: number, drafts: Array<Record<string, unknown>>, candidatesOmitted: number) => {
      if (!mine().some((c) => c.deckNumber === deckNumber)) {
        drafts.forEach((d, index) => {
          cards().push({
            id: crypto.randomUUID(),
            userId,
            deckNumber,
            position: index + 1,
            kind: d.kind as Kind,
            status: 'pending',
            targetThoughtId: d.thoughtId as string | null,
            targetProjectEntityId: d.projectEntityId as string | null,
            payload: {
              text: d.text as string,
              why: d.why as string,
              suggestedStep: d.suggestedStep as string | null,
              notTaskCategory: d.notTaskCategory as string | null,
              candidatesOmitted,
            },
            answer: null,
          })
        })
      }
      return mine()
        .filter((c) => c.deckNumber === deckNumber && c.status === 'pending')
        .sort((a, b) => a.position - b.position)
        .map(view)
    },
    decryptPayload: async (stored: { id: string }) => (cards().find((c) => c.id === stored.id) as FakeCard).payload,
    resolveProject: async (stored: { targetProjectEntityId: string | null }) => {
      const p = stored.targetProjectEntityId ? projects().get(stored.targetProjectEntityId) : undefined
      return p && p.userId === userId ? { id: p.id, label: p.label } : null
    },
    otherProjects: async (stored: { targetProjectEntityId: string | null }) =>
      [...projects().values()]
        .filter((p) => p.userId === userId && p.status === 'active' && p.id !== stored.targetProjectEntityId)
        .map((p) => ({ id: p.id, label: p.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    actual,
  }
}

vi.mock('$lib/server/mesh/now-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/mesh/now-store')>()
  return {
    ...actual,
    loadNowDeck: async (userId: string) => {
      const { actual: _unused, ...deps } = storeDeps(userId, actual)
      return actual.resolveNowDeck(deps)
    },
  }
})

// The write: the real decisions (`runNowAnswer`) over in-memory writes.
vi.mock('$lib/server/mesh/now-answer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/mesh/now-answer')>()
  const store = await vi.importMock<typeof import('$lib/server/mesh/now-store')>('$lib/server/mesh/now-store')
  return {
    ...actual,
    answerNowCard: async (input: {
      userId: string
      cardId: string
      answer: string
      projectEntityId?: string
      text?: string
    }) => {
      const { userId, ...rest } = input
      const mine = (id: string) => cards().find((c) => c.id === id && c.userId === userId)
      const now = new Date('2026-11-09T09:30:00Z')
      return actual.runNowAnswer(
        {
          loadCard: async (id: string) => {
            const card = mine(id)
            return card
              ? {
                  id: card.id,
                  kind: card.kind,
                  status: card.status as 'pending',
                  targetThoughtId: card.targetThoughtId,
                  targetProjectEntityId: card.targetProjectEntityId,
                  payload: card.payload,
                }
              : null
          },
          projectStatus: async (id: string) => {
            const p = projects().get(id)
            return p && p.userId === userId ? p.status : null
          },
          claim: async (id: string, answer: string) => {
            const card = mine(id)
            if (!card || card.status !== 'pending') return false
            card.status = 'answered'
            card.answer = answer
            return true
          },
          release: async (id: string) => {
            const card = mine(id)
            if (card) {
              card.status = 'pending'
              card.answer = null
            }
          },
          hideUntil: async () => undefined,
          timeZone: async () => 'UTC',
          setLifecycle: async (id: string, status: 'completed' | 'archived') => {
            const t = thoughts().get(id)
            if (t) t.lifecycle = status
          },
          setCategory: async (id: string, key: string) => {
            const t = thoughts().get(id)
            if (t) t.category = key
          },
          captureStep: async (text: string) => {
            const id = crypto.randomUUID()
            thoughts().set(id, { id, userId, text, category: 'task', lifecycle: 'open' })
            return id
          },
          linkToProject: async (projectId: string, thoughtId: string) => {
            world.memberships.push({ projectId, thoughtId })
          },
          appendToProjectOrder: async () => undefined,
          projectHasNextAction: async (id: string) => projects().get(id)?.nextActionThoughtId != null,
          designateNextAction: async (projectId: string, thoughtId: string) => {
            const p = projects().get(projectId)
            if (p) p.nextActionThoughtId = thoughtId
          },
          setProjectStatus: async (id: string, status: 'someday' | 'completed') => {
            const p = projects().get(id)
            if (p) p.status = status
          },
          snapshot: async (thoughtId: string) => ({
            thoughtId,
            lifecycleStatus: 'open' as const,
            category: 'task',
            memberships: [],
            projects: [],
          }),
          saveUndo: async () => undefined,
          loadNext: async () => {
            const { actual: _a, ...deps } = storeDeps(userId, store as never)
            return (store as never as typeof import('$lib/server/mesh/now-store')).resolveNow(deps)
          },
        },
        { ...rest, now },
      )
    },
  }
})

// Cleanup tools: a thought archived by id, a project status set by id, projects listed.
vi.mock('$lib/server/memory/lifecycle', () => ({
  archiveThoughtForUser: async (userId: string, thoughtId: string) => {
    const t = thoughts().get(thoughtId)
    if (!t || t.userId !== userId) return { ok: false, reason: 'not_found' }
    t.lifecycle = 'archived'
    return { ok: true }
  },
}))
vi.mock('$lib/server/capture/service', () => ({
  listThoughts: async (userId: string) =>
    [...thoughts().values()]
      .filter((t) => t.userId === userId && t.lifecycle === 'open')
      .map((t) => ({ id: t.id, category: t.category, normalizedText: t.text, createdAt: new Date() })),
}))
vi.mock('$lib/server/memory/project-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/memory/project-list')>()),
  updateProjectStatus: async (userId: string, entityId: string, status: FakeProject['status']) => {
    const p = projects().get(entityId)
    if (!p || p.userId !== userId) throw new Error('Project not found or not owned by user')
    p.status = status
    return { entityId, status }
  },
  listProjectsForUser: async (userId: string) =>
    [...projects().values()]
      .filter((p) => p.userId === userId)
      .map((p) => ({
        entityId: p.id,
        label: p.label,
        status: p.status,
        source: 'manual',
        openTaskCount: 0,
        targetDate: null,
        nextAction: null,
        stalled: null,
        tasks: [],
        milestones: [],
      })),
}))

import { CHAT_AGENT_TOOL_NAMES } from './registry'
import { createMcpServer } from './server'

const USER = 'u1'
const T1 = 'th-1'
const T2 = 'th-2'
const T3 = 'th-3'
const P_SEWER = '6a0c1e52-1b7f-4d63-8a41-0f2d9e3b7c01'
const P_HYDRA = '6a0c1e52-1b7f-4d63-8a41-0f2d9e3b7c02'
const P_GARDEN = '6a0c1e52-1b7f-4d63-8a41-0f2d9e3b7c03'

/** Another user's rows get their own ids, so two users never share a row of the fake world. */
function seed(userId = USER) {
  const own = userId === USER
  const id = (base: string) => (own ? base : `${base}@${userId}`)
  const t = (base: string, text: string, extra: Partial<FakeThought> = {}) =>
    thoughts().set(id(base), { id: id(base), userId, text, category: 'task', lifecycle: 'open', ...extra })
  t(T1, 'Send the form to the accountant')
  t(T2, 'Call the dentist')
  t(T3, 'Pay the Hydra invoice', { fileTo: id(P_HYDRA) })
  t('th-hydra-next', 'Hydra kickoff', { category: 'note' })
  t('th-garden-next', 'Buy seeds', { category: 'note' })
  projects().set(id(P_SEWER), {
    id: id(P_SEWER),
    userId,
    label: 'Sewer',
    status: 'active',
    nextActionThoughtId: null,
    suggestedStep: 'Book the site visit',
  })
  projects().set(id(P_HYDRA), {
    id: id(P_HYDRA),
    userId,
    label: 'Hydra',
    status: 'active',
    nextActionThoughtId: id('th-hydra-next'),
    suggestedStep: '',
  })
  projects().set(id(P_GARDEN), {
    id: id(P_GARDEN),
    userId,
    label: 'Garden',
    status: 'active',
    nextActionThoughtId: id('th-garden-next'),
    suggestedStep: '',
  })
}

type CardPayload = {
  id: string
  kind: Kind
  text: string
  why: string
  suggestedStep?: string
  project: { id: string; label: string } | null
  answers: string[]
  otherProjects?: Array<{ id: string; label: string }>
}

type ToolPayload = {
  state: string
  cards: CardPayload[]
  candidatesOmitted: number
  answered: { cardId: string; answer: string }
  next: { state: string; card?: CardPayload; remaining?: number }
  results: Array<{ id: string }>
  count: number
  projects: Array<{ entityId: string; status: string }>
  [key: string]: unknown
}

/** An agent on the other end of the MCP wire: it only ever sees tool names, arguments and JSON text. */
async function connectAgent(userId = USER) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer({ userId }, { boardAccess: false, boardAdmin: false })
  const client = new Client({ name: 'test-drive-agent', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const calls: string[] = []

  async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolPayload> {
    calls.push(name)
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content: Array<{ type: string; text: string }>
    }
    const text = result.content[0].text
    if (result.isError) throw new Error(text)
    return JSON.parse(text) as ToolPayload
  }

  async function failure(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      await call(name, args)
    } catch (err) {
      return (err as Error).message
    }
    throw new Error(`expected ${name} to fail`)
  }

  return { client, call, failure, calls, close: () => client.close() }
}

beforeEach(() => {
  world.thoughts.clear()
  world.projects.clear()
  world.cards.length = 0
  world.memberships.length = 0
  world.llmCalls = 0
  seed()
})

describe('Now test-drive: the happy path stays within its budget', () => {
  it('get_now_cards → answer_now_card is 2 calls, and each tells the truth', async () => {
    const BUDGET = 2
    const agent = await connectAgent()

    const deck = await agent.call('get_now_cards')
    expect(deck.state).toBe('cards')
    expect(deck.cards.map((c) => [c.kind, c.text])).toEqual([
      ['do', 'Send the form to the accountant'],
      ['do', 'Call the dentist'],
      ['file', 'File "Pay the Hydra invoice" under Hydra?'],
      ['unblock', 'Sewer has no next step.'],
    ])
    expect(deck.cards[0]).toEqual({
      id: deck.cards[0].id,
      kind: 'do',
      text: 'Send the form to the accountant',
      why: 'It has been open a while.',
      project: null,
      answers: ['done', 'not_now', 'too_big'],
    })
    expect(deck.cards[2]).toMatchObject({
      project: { id: P_HYDRA, label: 'Hydra' },
      answers: ['yes', 'other_project', 'not_a_task'],
      otherProjects: [
        { id: P_GARDEN, label: 'Garden' },
        { id: P_SEWER, label: 'Sewer' },
      ],
    })
    expect(deck.cards[3]).toMatchObject({
      suggestedStep: 'Book the site visit',
      answers: ['yes', 'something_else', 'someday', 'finished'],
    })
    expect(world.llmCalls).toBe(1)

    const answered = await agent.call('answer_now_card', { card_id: deck.cards[0].id, answer: 'done' })
    expect(answered.answered).toEqual({ cardId: deck.cards[0].id, answer: 'done' })
    expect(answered.next).toMatchObject({ state: 'card', card: { text: 'Call the dentist' }, remaining: 2 })
    expect(thoughts().get(T1)?.lifecycle).toBe('completed')

    expect(agent.calls).toEqual(['get_now_cards', 'answer_now_card'])
    expect(agent.calls.length).toBeLessThanOrEqual(BUDGET)
    await agent.close()
  })

  it('a read after the answer shows the rest of the deck, and no second LLM call ran', async () => {
    const agent = await connectAgent()
    const deck = await agent.call('get_now_cards')
    await agent.call('answer_now_card', { card_id: deck.cards[0].id, answer: 'done' })

    const after = await agent.call('get_now_cards')
    expect(after.cards.map((c) => c.id)).toEqual(deck.cards.slice(1).map((c) => c.id))
    expect(world.llmCalls).toBe(1)
    await agent.close()
  })

  it('reading twice returns the same deck without writing another', async () => {
    const agent = await connectAgent()
    const first = await agent.call('get_now_cards')
    const second = await agent.call('get_now_cards')
    expect(second.cards.map((c) => c.id)).toEqual(first.cards.map((c) => c.id))
    expect(world.llmCalls).toBe(1)
    await agent.close()
  })

  it('other_project files the thought under the project the agent chose', async () => {
    const agent = await connectAgent()
    const deck = await agent.call('get_now_cards')
    const file = deck.cards[2]

    await agent.call('answer_now_card', {
      card_id: file.id,
      answer: 'other_project',
      project_entity_id: P_GARDEN,
    })
    expect(world.memberships).toEqual([{ projectId: P_GARDEN, thoughtId: T3 }])
    await agent.close()
  })
})

describe('Now test-drive: states', () => {
  it('clear: nothing needs the user, no LLM call', async () => {
    world.thoughts.clear()
    world.projects.clear()
    const agent = await connectAgent()
    const result = await agent.call('get_now_cards')
    expect(result.state).toBe('clear')
    expect(result.cards).toBeUndefined()
    expect(world.llmCalls).toBe(0)
    await agent.close()
  })

  it('limit: three decks today and none pending, no LLM call', async () => {
    for (const deckNumber of [1, 2, 3]) {
      cards().push({
        id: crypto.randomUUID(),
        userId: USER,
        deckNumber,
        position: 1,
        kind: 'do',
        status: 'answered',
        targetThoughtId: T1,
        targetProjectEntityId: null,
        payload: { text: 'x', why: 'y', suggestedStep: null, notTaskCategory: null, candidatesOmitted: 0 },
        answer: 'done',
      })
    }
    const agent = await connectAgent()
    const result = await agent.call('get_now_cards')
    expect(result.state).toBe('limit')
    expect(world.llmCalls).toBe(0)
    await agent.close()
  })

  it('shows only the caller’s own cards', async () => {
    seed('u2')
    const mine = await connectAgent(USER)
    const theirs = await connectAgent('u2')
    const a = await mine.call('get_now_cards')
    const b = await theirs.call('get_now_cards')
    const ids = new Set(a.cards.map((c) => c.id))
    expect(b.cards.some((c) => ids.has(c.id))).toBe(false)
    await mine.close()
    await theirs.close()
  })
})

describe('Now test-drive: cleanup works and is verified', () => {
  it('a Yes on an unblock card captures a step; delete_thought removes it, and the next read agrees', async () => {
    const agent = await connectAgent()
    const deck = await agent.call('get_now_cards')
    const before = new Set(
      (await agent.call('retrieve_thoughts', { order: 'created_at', detail: 'full' })).results.map((r) => r.id),
    )
    await agent.call('answer_now_card', { card_id: deck.cards[3].id, answer: 'yes' })

    const listed = await agent.call('retrieve_thoughts', { order: 'created_at', detail: 'full' })
    const created = listed.results.filter((r) => !before.has(r.id))
    expect(created).toHaveLength(1)
    const removed = await agent.call('delete_thought', { thought_id: created[0].id })
    expect(removed).toMatchObject({ archived: true, thoughtId: created[0].id })

    const after = await agent.call('retrieve_thoughts', { order: 'created_at', detail: 'full' })
    expect(after.results.map((r) => r.id)).not.toContain(created[0].id)
    await agent.close()
  })

  it('Someday on an unblock card is undone with edit_project, verified by list_projects and get_now_cards', async () => {
    const agent = await connectAgent()
    const deck = await agent.call('get_now_cards')
    await agent.call('answer_now_card', { card_id: deck.cards[3].id, answer: 'someday' })
    const during = await agent.call('list_projects')
    expect(during.projects.find((p) => p.entityId === P_SEWER)?.status).toBe('someday')

    await agent.call('edit_project', { project_entity_id: P_SEWER, status: 'active' })

    const after = await agent.call('list_projects')
    expect(after.projects.find((p) => p.entityId === P_SEWER)?.status).toBe('active')
    await agent.close()
  })
})

describe('Now test-drive: negative probes fail loud with the exact constraint', () => {
  async function drivenDeck() {
    const agent = await connectAgent()
    const deck = await agent.call('get_now_cards')
    return { agent, cards: deck.cards }
  }

  it('an answer the card kind does not offer is refused and lists the ones it does', async () => {
    const { agent, cards: deck } = await drivenDeck()
    expect(await agent.failure('answer_now_card', { card_id: deck[0].id, answer: 'maybe' })).toContain(
      'answer must be one of: done, not_now, too_big',
    )
    // too_big belongs to do cards, not file cards
    expect(await agent.failure('answer_now_card', { card_id: deck[2].id, answer: 'too_big' })).toContain(
      'answer must be one of: yes, other_project, not_a_task',
    )
    expect(thoughts().get(T1)?.lifecycle).toBe('open')
    expect(cards().every((c) => c.status === 'pending')).toBe(true)
    await agent.close()
  })

  it('other_project without project_entity_id names the missing argument', async () => {
    const { agent, cards: deck } = await drivenDeck()
    expect(await agent.failure('answer_now_card', { card_id: deck[2].id, answer: 'other_project' })).toContain(
      'project_entity_id is required for other_project',
    )
    expect(world.memberships).toEqual([])
    await agent.close()
  })

  it('project_entity_id with another answer, or that is not a uuid, is refused', async () => {
    const { agent, cards: deck } = await drivenDeck()
    expect(
      await agent.failure('answer_now_card', {
        card_id: deck[2].id,
        answer: 'yes',
        project_entity_id: P_GARDEN,
      }),
    ).toContain('project_entity_id is only allowed for other_project')
    expect(
      await agent.failure('answer_now_card', {
        card_id: deck[2].id,
        answer: 'other_project',
        project_entity_id: 'abc',
      }),
    ).toContain('project_entity_id must be a uuid')
    await agent.close()
  })

  it('a card_id that is not a uuid is refused', async () => {
    const { agent } = await drivenDeck()
    expect(await agent.failure('answer_now_card', { card_id: 'abc', answer: 'done' })).toContain(
      'card_id must be a uuid',
    )
    await agent.close()
  })

  it('an unknown argument names the allowed ones, on both tools', async () => {
    const { agent, cards: deck } = await drivenDeck()
    expect(await agent.failure('answer_now_card', { cardId: deck[0].id, answer: 'done' })).toContain(
      'Unknown argument: cardId. Allowed: card_id, answer, project_entity_id, text',
    )
    expect(await agent.failure('get_now_cards', { limit: 3 })).toContain(
      'Unknown argument: limit. Allowed: (none)',
    )
    await agent.close()
  })

  it('a missing answer is refused', async () => {
    const { agent, cards: deck } = await drivenDeck()
    expect(await agent.failure('answer_now_card', { card_id: deck[0].id })).toContain(
      'answer is required and must be a string',
    )
    await agent.close()
  })

  it('a card that does not exist, or is another user’s, is Card not found', async () => {
    const { agent } = await drivenDeck()
    seed('u2')
    const stranger = await connectAgent('u2')
    const foreign = (await stranger.call('get_now_cards')).cards[0].id

    for (const id of [crypto.randomUUID(), foreign]) {
      expect(await agent.failure('answer_now_card', { card_id: id, answer: 'done' })).toContain(
        'Card not found',
      )
    }
    expect(cards().find((c) => c.id === foreign)?.status).toBe('pending')
    await agent.close()
    await stranger.close()
  })

  it('answering a card twice says it was already answered', async () => {
    const { agent, cards: deck } = await drivenDeck()
    await agent.call('answer_now_card', { card_id: deck[0].id, answer: 'done' })
    expect(await agent.failure('answer_now_card', { card_id: deck[0].id, answer: 'done' })).toContain(
      'This card was already answered',
    )
    await agent.close()
  })
})

describe('Now test-drive: the tools an MCP client is offered', () => {
  it('lists get_now_cards and answer_now_card with their contracts', async () => {
    const agent = await connectAgent()
    const { tools } = await agent.client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))

    expect(byName.get('get_now_cards')?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    })
    expect(byName.get('answer_now_card')?.inputSchema).toMatchObject({
      required: ['card_id', 'answer'],
      additionalProperties: false,
      properties: { card_id: { type: 'string' }, answer: { type: 'string' } },
    })
    await agent.close()
  })

  it('Ask has both Now tools: get_now_cards (its picker) and answer_now_card, like every MCP tool', () => {
    expect(CHAT_AGENT_TOOL_NAMES).toContain('get_now_cards')
    expect(CHAT_AGENT_TOOL_NAMES).toContain('answer_now_card')
  })
})
