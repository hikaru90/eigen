import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  loadYarnThoughts: vi.fn(),
  getUserPreferredTimezone: vi.fn(async () => 'Europe/Berlin'),
  loadThoughtKindOptions: vi.fn(async () => [{ key: 'task', name: 'Task', definition: 'To do' }]),
  ensureUserOntologySeeded: vi.fn(async () => undefined),
  loadOntologyForUser: vi.fn(async () => ({ entityKinds: [{ key: 'task', name: 'Task' }] })),
}))

vi.mock('$lib/server/mesh/yarn-list', () => ({ loadYarnThoughts: m.loadYarnThoughts }))
vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: m.getUserPreferredTimezone,
}))
vi.mock('$lib/server/thought/kind-options', () => ({
  loadThoughtKindOptions: m.loadThoughtKindOptions,
}))
vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: m.ensureUserOntologySeeded,
  loadOntologyForUser: m.loadOntologyForUser,
}))
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({})) }))

import { load } from './+page.server'

function yarnRow(id: string, verdict: 'up' | 'down' | null) {
  return {
    id,
    text: `words of ${id}`,
    category: 'task',
    createdAtIso: '2026-10-27T10:00:00.000Z',
    status: 'open',
    isTodo: true,
    threadLabel: null,
    threadEntityId: null,
    related: [],
    verdict,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Yarn load: the vote on each row', () => {
  it('hands the strand to the page with each row’s verdict, as the shared reader read it', async () => {
    m.loadYarnThoughts.mockResolvedValue([
      yarnRow('a', 'up'),
      yarnRow('b', null),
      yarnRow('c', 'down'),
    ])

    const data = (await load({ locals: { user: { id: 'u1' } } } as never)) as {
      thoughts: Array<{ id: string; verdict: string | null }>
    }

    expect(m.loadYarnThoughts).toHaveBeenCalledWith('u1', { author: 'user' })
    expect(data.thoughts.map((t) => [t.id, t.verdict])).toEqual([
      ['a', 'up'],
      ['b', null],
      ['c', 'down'],
    ])
  })

  it('sends anonymous users to /login before reading anything', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 })
    expect(m.loadYarnThoughts).not.toHaveBeenCalled()
  })
})
