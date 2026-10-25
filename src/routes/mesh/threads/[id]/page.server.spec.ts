import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listProjectsByEntityIds: vi.fn(),
  loadYarnThoughts: vi.fn(),
  getUserPreferredTimezone: vi.fn(async () => 'Europe/Berlin'),
  loadThoughtKindOptions: vi.fn(async () => [{ key: 'task', name: 'Task', definition: 'To do' }]),
}))

vi.mock('$lib/server/memory/project-list', () => ({ listProjectsByEntityIds: m.listProjectsByEntityIds }))
vi.mock('$lib/server/mesh/yarn-list', () => ({ loadYarnThoughts: m.loadYarnThoughts }))
vi.mock('$lib/server/memory/user-timezone', () => ({ getUserPreferredTimezone: m.getUserPreferredTimezone }))
vi.mock('$lib/server/thought/kind-options', () => ({ loadThoughtKindOptions: m.loadThoughtKindOptions }))
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({})) }))

import { load } from './+page.server'

const project = {
  entityId: 'p1',
  label: 'Studio',
  status: 'active',
  nextAction: null,
  openTaskCount: 0,
  targetDate: null,
  stalled: null,
  milestones: [],
}

function yarnRow(id: string, category: string, status: 'open' | 'completed' = 'open') {
  return {
    id,
    text: `words of ${id}`,
    category,
    createdAtIso: '2026-10-25T10:00:00.000Z',
    status,
    isTodo: category === 'task',
    threadLabel: 'Studio',
    threadEntityId: 'p1',
  }
}

function event(id = 'p1') {
  return {
    locals: { user: { id: 'u1' } },
    params: { id },
    depends: vi.fn(),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  m.listProjectsByEntityIds.mockResolvedValue([project])
})

describe('a thread lists every thought on it (board b6f74d02)', () => {
  it('lists decisions and questions too, not only tasks — read from thread membership', async () => {
    m.loadYarnThoughts.mockResolvedValue([
      yarnRow('d1', 'decision'),
      yarnRow('q1', 'question'),
      yarnRow('t1', 'task', 'completed'),
    ])
    const data = (await load(event())) as {
      thoughts: Array<{ thoughtId: string; category: string }>
      questions: Array<{ thoughtId: string }>
      kinds: unknown[]
    }
    expect(m.loadYarnThoughts).toHaveBeenCalledWith('u1', { author: 'all', threadEntityId: 'p1' })
    expect(data.thoughts.map((t) => t.thoughtId)).toEqual(['d1', 'q1', 't1'])
    expect(data.questions.map((q) => q.thoughtId)).toEqual(['q1'])
    expect(data.kinds).toHaveLength(1)
  })

  it('a hub that is not a listed project is a 404', async () => {
    m.listProjectsByEntityIds.mockResolvedValue([])
    await expect(load(event('p9'))).rejects.toMatchObject({ status: 404 })
    expect(m.loadYarnThoughts).not.toHaveBeenCalled()
  })

  it('negative probe: a malformed id is a 400 before any read', async () => {
    await expect(load(event('bad id'))).rejects.toMatchObject({ status: 400 })
    expect(m.listProjectsByEntityIds).not.toHaveBeenCalled()
  })
})
