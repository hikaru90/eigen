import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDailyDigest } from './daily-digest'

const m = vi.hoisted(() => ({
  events: vi.fn(),
  projects: vi.fn(),
  openThreads: vi.fn(),
  layers: vi.fn(),
  yarn: vi.fn(),
  agentCounts: {} as Record<string, number>,
}))

vi.mock('$lib/server/memory/temporal-event-list', () => ({ listTemporalEventsForUser: m.events }))
vi.mock('$lib/server/memory/project-list', () => ({ listProjects: m.projects }))
vi.mock('$lib/server/memory/open-threads', () => ({
  loadOpenThreads: m.openThreads,
  snippetForOpenThread: (text: string) => text.split('\n')[0],
}))
vi.mock('$lib/server/memory/authorship', () => ({
  listAuthorLayersForUser: m.layers,
  // the count query's author condition carries the layer key through to the fake db
  resolveAuthorSqlCondition: (_cols: unknown, filter: { authorLayerKey: string }) => filter.authorLayerKey,
}))
vi.mock('$lib/server/mesh/yarn-list', () => ({ loadYarnThoughts: m.yarn }))
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...conds: unknown[]) => conds.find((c) => typeof c === 'string'),
}))
vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: async (key: string) => [{ n: m.agentCounts[key] ?? 0 }] }),
    }),
  }),
}))

const now = new Date('2026-10-24T08:00:00.000Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString()

describe('loadDailyDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.events.mockResolvedValue({ items: [] })
    m.projects.mockResolvedValue([
      { entityId: 'p1', label: 'Eigenmesh', status: 'active', nextAction: { summary: 'Ship it' } },
      { entityId: 'p2', label: 'Someday thing', status: 'someday', nextAction: null },
    ])
    m.openThreads.mockResolvedValue({
      stalledProjects: [{ entityId: 'p1', label: 'Eigenmesh', stalled: { reason: 'no_next_action' } }],
      orphanThreads: Array.from({ length: 7 }, (_, i) => ({ thoughtId: `o${i}`, snippet: `old ${i}` })),
    })
    m.layers.mockResolvedValue([
      { key: 'user', label: 'You', kind: 'user' },
      { key: 'apikey:a', label: 'pi.dev', kind: 'agent' },
      { key: 'apikey:b', label: 'zai', kind: 'agent' },
      { key: 'apikey:c', label: 'quiet', kind: 'agent' },
    ])
    m.agentCounts = { 'apikey:a': 2, 'apikey:b': 9, 'apikey:c': 0 }
    m.yarn.mockImplementation(async (_u: string, { authorLayerKey }: { authorLayerKey: string }) =>
      authorLayerKey === 'apikey:a'
        ? [
            { id: 'a1', text: 'fresh report\nmore', createdAtIso: hoursAgo(2) },
            { id: 'a0', text: 'two days old', createdAtIso: hoursAgo(48) },
          ]
        : [],
    )
  })

  it('lists active projects with their next action', async () => {
    const digest = await loadDailyDigest('u1', 'UTC', now)
    expect(digest.projects).toEqual([{ entityId: 'p1', label: 'Eigenmesh', nextAction: 'Ship it' }])
    expect(m.projects).toHaveBeenCalledWith('u1', { kind: 'user' })
  })

  it('reports stalled threads and the newest loose tasks', async () => {
    const digest = await loadDailyDigest('u1', 'UTC', now)
    expect(digest.stalled).toEqual([{ entityId: 'p1', label: 'Eigenmesh', reason: 'no_next_action' }])
    expect(digest.unthreaded.count).toBe(7)
    expect(digest.unthreaded.recent.map((r) => r.thoughtId)).toEqual(['o6', 'o5', 'o4', 'o3', 'o2'])
  })

  it('counts each agent over the last day, busiest first, with only today’s captures listed', async () => {
    const digest = await loadDailyDigest('u1', 'UTC', now)
    expect(digest.agents.map((a) => [a.label, a.count])).toEqual([
      ['zai', 9],
      ['pi.dev', 2],
    ])
    expect(digest.agents[1].recent).toEqual([{ thoughtId: 'a1', snippet: 'fresh report' }])
  })
})
