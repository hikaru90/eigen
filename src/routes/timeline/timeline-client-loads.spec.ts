import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TIMELINE_MOUNT_FETCH_BUDGET,
  findMountFetchBudgetViolations,
  isTimelineUnifiedFetch,
  shouldRefetchForViewChange,
  shouldRefetchPrefetchForView,
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

  it('refetches prefetched data only when its author scope misses the current view', () => {
    // SSR prefetch is always author='user'; views beyond 'user' need a client fetch.
    expect(shouldRefetchPrefetchForView('user', 'user')).toBe(false)
    expect(shouldRefetchPrefetchForView('user', 'all')).toBe(true)
    expect(shouldRefetchPrefetchForView('user', 'apikey:mesh-1')).toBe(true)
    expect(shouldRefetchPrefetchForView('user', 'label:Runner')).toBe(true)
    // Unknown/absent scope must fail safe: refetch rather than show wrong scope.
    expect(shouldRefetchPrefetchForView(null, 'all')).toBe(true)
    expect(shouldRefetchPrefetchForView(null, 'user')).toBe(false)
    // A hypothetical non-user prefetch scope only matches the exact same view.
    expect(shouldRefetchPrefetchForView('all', 'all')).toBe(false)
    expect(shouldRefetchPrefetchForView('all', 'user')).toBe(true)
    expect(shouldRefetchPrefetchForView('apikey:mesh-1', 'apikey:mesh-1')).toBe(false)
    expect(shouldRefetchPrefetchForView('apikey:mesh-1', 'all')).toBe(true)
  })

  it('classifies the unified /api/timeline URL only', () => {
    expect(
      isTimelineUnifiedFetch(
        '/api/timeline?from=&to=&includeUndated=true&orderBy=ingest&sortDirection=desc&author=user',
      ),
    ).toBe(true)
    expect(isTimelineUnifiedFetch('/api/timeline/stats')).toBe(false)
    expect(isTimelineUnifiedFetch('/api/timeline/projects')).toBe(false)
    expect(isTimelineUnifiedFetch('/api/temporal-events?range=all')).toBe(false)
  })

  it('eval: cold mount stays within the single unified fetch budget', () => {
    // Prefetched SSR cold mount: zero client /api/timeline fetches is within budget.
    expect(findMountFetchBudgetViolations([])).toEqual([])
    const coldMountUrls = [
      '/api/timeline?from=&to=&includeUndated=true&orderBy=ingest&sortDirection=desc&author=user',
    ]
    expect(findMountFetchBudgetViolations(coldMountUrls)).toEqual([])
    expect(TIMELINE_MOUNT_FETCH_BUDGET).toEqual({ timelineUnified: 1 })
  })

  it('eval: rejects multi-fetch fan-out (legacy temporal-events + stats)', () => {
    const brokenProdLog = [
      '/api/timeline?from=&to=',
      '/api/timeline?from=&to=',
      '/api/temporal-events?range=all&status=open',
      '/api/timeline/stats',
    ]
    expect(findMountFetchBudgetViolations(brokenProdLog)).toEqual(['timeline unified: 2 > 1'])
  })
})

describe('timeline client load wiring contract', () => {
  it('uses onMount events — no $effect in shell or segment tabs', () => {
    const shell = readTimeline('timeline-shell.svelte')
    const tabs = readTimeline('temporal-today-segment-tabs.svelte')
    expect(shell).not.toMatch(/\$effect/)
    expect(tabs).not.toMatch(/\$effect/)
    expect(shell).toContain('onMount(')
    expect(shell).toContain('shouldRefetchForViewChange')
  })

  it('keeps segment tabs presentational (parent owns counts)', () => {
    const tabs = readTimeline('temporal-today-segment-tabs.svelte')
    expect(tabs).not.toContain("fetch('/api/timeline/stats')")
    expect(tabs).not.toContain('statsRefreshKey')
    expect(tabs).toContain('tabCounts: TimelineSegmentTabCounts')
  })

  it('suppresses thought-sync self-reload after local timeline refresh + notify', () => {
    const source = readTimeline('timeline-shell.svelte')
    expect(source).toContain('suppressThoughtSyncReload')
    expect(source).toContain('withThoughtSyncReloadSuppressedAsync')
    expect(source).toMatch(/if\s*\(\s*suppressThoughtSyncReload\s*\)\s*return/)
  })

  it('does not send kinds on timeline fetches', () => {
    const dataStore = readTimeline('timeline-data.svelte.ts')
    const derive = readTimeline('timeline-data-derive.ts')
    expect(dataStore).not.toContain("params.set('kinds'")
    expect(derive).not.toContain('kinds=')
  })

  it('refetches prefetched surfaces whose author scope misses the current view', () => {
    // Page load must report the author scope it prefetched with (SSR always 'user').
    const pageLoad = readTimeline('timeline-page-load.ts')
    expect(pageLoad).toContain('prefetchedAuthorScope')

    // Pages must forward the scope to the shell.
    const projectsPage = readTimeline('../memory/projects/+page.svelte')
    const tasksPage = readTimeline('../memory/tasks/+page.svelte')
    expect(projectsPage).toContain('prefetchedAuthorScope')
    expect(tasksPage).toContain('prefetchedAuthorScope')

    // Shell must consult the scope-vs-view mismatch helper in onMount.
    const shell = readTimeline('timeline-shell.svelte')
    expect(shell).toContain('shouldRefetchPrefetchForView')
  })
})
