import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  loadTimelinePageData: vi.fn(),
  loadThoughtKindOptions: vi.fn(async () => [{ key: 'task', name: 'Task', definition: 'To do' }]),
  loadCaptureVerdicts: vi.fn(),
}))

vi.mock('../../../timeline/timeline-page-load', () => ({
  loadTimelinePageData: m.loadTimelinePageData,
}))
vi.mock('$lib/server/thought/kind-options', () => ({ loadThoughtKindOptions: m.loadThoughtKindOptions }))
vi.mock('$lib/server/capture-review/vote-store', () => ({
  loadCaptureVerdicts: m.loadCaptureVerdicts,
}))
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({})) }))

import { load } from './+page.server'

function item(thoughtId: string, createdAt: string, projectEntityId: string | null = null) {
  return {
    thoughtId,
    thoughtText: `words of ${thoughtId}`,
    createdAt,
    thoughtCategory: 'task',
    thoughtStatus: 'open' as const,
    projectEntityId,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.loadTimelinePageData.mockResolvedValue({
    user: { id: 'u1' },
    preferredTimezone: 'Europe/Berlin',
    prefetchedTimeline: {
      items: [
        item('t1', '2026-10-25T10:00:00Z'),
        item('t1', '2026-10-25T10:00:00Z'),
        item('t2', '2026-10-26T10:00:00Z'),
        item('t3', '2026-10-24T10:00:00Z', 'p1'),
      ],
    },
  })
  m.loadCaptureVerdicts.mockResolvedValue(new Map())
})

describe('Loose ends load: the vote on each row', () => {
  it('carries each loose thought’s verdict, null when it was never voted on', async () => {
    m.loadCaptureVerdicts.mockResolvedValue(new Map([['t1', 'down']]))

    const data = (await load({} as never)) as {
      thoughts: Array<{ thoughtId: string; verdict: string | null }>
    }

    expect(data.thoughts.map((t) => [t.thoughtId, t.verdict])).toEqual([
      ['t2', null],
      ['t1', 'down'],
    ])
  })

  it('looks the verdicts up once, for this user and the loose thoughts only', async () => {
    await load({} as never)
    expect(m.loadCaptureVerdicts).toHaveBeenCalledTimes(1)
    expect(m.loadCaptureVerdicts).toHaveBeenCalledWith('u1', ['t2', 't1'])
  })

  it('fails loudly when the verdicts cannot be read', async () => {
    m.loadCaptureVerdicts.mockRejectedValue(new Error('db down'))
    await expect(load({} as never)).rejects.toThrow('db down')
  })
})
