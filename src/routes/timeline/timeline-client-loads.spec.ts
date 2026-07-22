import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TIMELINE_MOUNT_FETCH_BUDGET,
  classifyTemporalEventsFetch,
  findMountFetchBudgetViolations,
  isTimelineStatsFetch,
  shouldFetchTimelineStats,
  shouldRefetchForViewChange,
} from './timeline-client-loads'

const here = path.dirname(fileURLToPath(import.meta.url))

function readTimeline(relative: string): string {
  return readFileSync(path.join(here, relative), 'utf-8')
}

describe('timeline client load policy', () => {
  it('skips refetch on the initial currentUserView subscribe', () => {
    expect(shouldRefetchForViewChange(null, 'user')).toBe(false)
    expect(shouldRefetchForViewChange('user', 'user')).toBe(false)
    expect(shouldRefetchForViewChange('user', 'all')).toBe(true)
    expect(shouldRefetchForViewChange('all', 'user')).toBe(true)
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
