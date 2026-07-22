import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TIMELINE_MOUNT_FETCH_BUDGET,
  classifyTemporalEventsFetch,
  findMountFetchBudgetViolations,
  isTimelineStatsFetch,
  planFilterChangeFetches,
  shouldFetchTimelineStats,
  shouldRefetchForViewChange,
} from './timeline-client-loads'

const here = path.dirname(fileURLToPath(import.meta.url))

function readTimeline(relative: string): string {
  return readFileSync(path.join(here, relative), 'utf-8')
}

describe('timeline client load policy', () => {
  it('skips refetch on the initial currentUserView subscribe when null previous', () => {
    expect(shouldRefetchForViewChange(null, 'user')).toBe(false)
    expect(shouldRefetchForViewChange('user', 'user')).toBe(false)
    expect(shouldRefetchForViewChange('user', 'all')).toBe(true)
    expect(shouldRefetchForViewChange('all', 'user')).toBe(true)
  })

  it('refetches when first subscribe differs from the view used for mount fetch', () => {
    // Mount fetched with default 'user'; localStorage holds 'all'
    expect(shouldRefetchForViewChange('user', 'all')).toBe(true)
    // Mount fetched with default 'user'; store echoes 'user' — no refetch
    expect(shouldRefetchForViewChange('user', 'user')).toBe(false)
  })

  it('statusFilter toggles issue zero server fetches (client-side only)', () => {
    expect(planFilterChangeFetches('status', { nowSegment: 'todo' })).toEqual({
      loadEvents: false,
      loadOverdue: false,
      loadDone: false,
      loadStats: false,
    })
    expect(planFilterChangeFetches('status', { nowSegment: 'overdue' })).toEqual({
      loadEvents: false,
      loadOverdue: false,
      loadDone: false,
      loadStats: false,
    })
  })

  it('date-range / data-view / order changes load list + stats once (not overdue/done unless active)', () => {
    expect(planFilterChangeFetches('dateRange', { nowSegment: 'todo' })).toEqual({
      loadEvents: true,
      loadOverdue: false,
      loadDone: false,
      loadStats: true,
    })
    expect(planFilterChangeFetches('dataView', { nowSegment: 'overdue' })).toEqual({
      loadEvents: true,
      loadOverdue: true,
      loadDone: false,
      loadStats: true,
    })
    expect(planFilterChangeFetches('orderBy', { nowSegment: 'done' })).toEqual({
      loadEvents: true,
      loadOverdue: false,
      loadDone: true,
      loadStats: true,
    })
  })

  it('fetches timeline stats only on mount and explicit reload keys', () => {
    expect(shouldFetchTimelineStats(null, 0)).toBe(true)
    expect(shouldFetchTimelineStats(0, 0)).toBe(false)
    expect(shouldFetchTimelineStats(0, 1)).toBe(true)
    expect(shouldFetchTimelineStats(1, 1)).toBe(false)
  })

  it('classifies the prod duplicate URLs from DevTools', () => {
    expect(
      classifyTemporalEventsFetch(
        '/api/temporal-events?from=&to=&includeUndated=true&status=all&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      ),
    ).toBe('relevant')
    expect(
      classifyTemporalEventsFetch(
        '/api/temporal-events?range=all&status=open&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      ),
    ).toBe('overdue-open')
    expect(
      classifyTemporalEventsFetch(
        '/api/temporal-events?range=relevant&status=all&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      ),
    ).toBe('relevant')
    expect(isTimelineStatsFetch('/api/timeline/stats')).toBe(true)
  })

  it('eval: cold mount stays within the fetch budget (shared with headed release e2e)', () => {
    const coldMountUrls = [
      '/api/temporal-events?range=all&status=open&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      '/api/temporal-events?from=&to=&includeUndated=true&status=all&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      '/api/timeline/stats?from=&to=&includeUndated=true',
    ]
    expect(findMountFetchBudgetViolations(coldMountUrls)).toEqual([])
    expect(TIMELINE_MOUNT_FETCH_BUDGET).toEqual({
      temporalEventsRelevant: 1,
      temporalEventsOverdueOpen: 1,
      timelineStats: 1,
    })
  })

  it('eval: rejects the pre-fix prod fan-out pattern', () => {
    const brokenProdLog = [
      '/api/temporal-events?range=all&status=open&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      '/api/temporal-events?from=&to=&includeUndated=true&status=all&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      '/api/temporal-events?from=&to=&includeUndated=true&status=all&includeTasks=true&orderBy=ingest&sortDirection=desc&author=user',
      '/api/timeline/stats',
      '/api/timeline/stats',
      '/api/timeline/stats',
      '/api/timeline/stats',
      '/api/timeline/stats',
      '/api/timeline/stats',
      '/api/timeline/stats',
    ]
    expect(findMountFetchBudgetViolations(brokenProdLog)).toEqual([
      'temporal-events relevant: 2 > 1',
      'timeline/stats: 7 > 1',
    ])
  })
})

describe('timeline client load wiring contract', () => {
  it('uses onMount events — no $effect in TemporalEvents or segment tabs', () => {
    const events = readTimeline('temporal-events.svelte')
    const tabs = readTimeline('temporal-today-segment-tabs.svelte')
    expect(events).not.toMatch(/\$effect/)
    expect(tabs).not.toMatch(/\$effect/)
    expect(events).toContain('onMount(')
    expect(events).toContain('void loadStats()')
    expect(events).toContain('shouldRefetchForViewChange')
  })

  it('wires planFilterChangeFetches and seeds previousView from mount dataView', () => {
    const events = readTimeline('temporal-events.svelte')
    expect(events).toContain('planFilterChangeFetches')
    expect(events).toContain('null = dataView')
    expect(events).toMatch(/function setStatusFilter[\s\S]*?statusFilter\s*=\s*next/)
    // statusFilter must not call the full server fan-out
    expect(events).toMatch(
      /function setStatusFilter\(next: TemporalStatusFilter\) \{\s*statusFilter = next\s*\}/,
    )
  })

  it('keeps segment tabs presentational (parent owns stats fetch)', () => {
    const tabs = readTimeline('temporal-today-segment-tabs.svelte')
    expect(tabs).not.toContain("fetch('/api/timeline/stats')")
    expect(tabs).not.toContain('statsRefreshKey')
    expect(tabs).toContain('tabCounts: TimelineSegmentTabCounts')
  })

  it('suppresses thought-sync self-reload after local timeline refresh + notify', () => {
    const source = readTimeline('temporal-events.svelte')
    expect(source).toContain('suppressThoughtSyncReload')
    expect(source).toContain('withThoughtSyncReloadSuppressedAsync')
    expect(source).toMatch(/if\s*\(\s*suppressThoughtSyncReload\s*\)\s*return/)
  })

  it('does not send kinds on temporal-events fetches', () => {
    const source = readTimeline('temporal-events.svelte')
    expect(source).not.toContain("params.set('kinds'")
    expect(source).not.toContain('kindFilter')
  })
})
