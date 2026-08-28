import type { CurrentUserView } from '$lib/memory/current-user-view'

/**
 * Prod fetch budget for a cold `/memory/tasks` mount under the single-source-of-truth model.
 * One unified `GET /api/timeline` — no separate overdue or stats fetches.
 */
export const TIMELINE_MOUNT_FETCH_BUDGET = {
  /** `GET /api/timeline` — items + project catalog once */
  timelineUnified: 1,
} as const

/**
 * Store subscribe fires immediately with the current value. Mount already loads
 * lists in `onMount`, so the initial subscribe must not refetch when `previous`
 * is null (caller has not yet seeded the mount-fetch view).
 */
export function shouldRefetchForViewChange(
  previous: CurrentUserView | null,
  next: CurrentUserView,
): boolean {
  if (previous === null) return false
  return previous !== next
}

/**
 * SSR prefetches timeline data with a hard-coded author scope (the selected
 * global view lives in localStorage, invisible to the server). When the
 * client's current view does not match that scope, the shell must refetch
 * instead of painting stale data (Projects tab cards derive from this scope).
 */
export function shouldRefetchPrefetchForView(
  prefetchAuthorScope: string | null,
  currentView: CurrentUserView,
): boolean {
  if (prefetchAuthorScope === null) return currentView !== 'user'
  return prefetchAuthorScope !== currentView
}

/** Classify unified timeline list URLs for fetch-budget assertions. */
export function isTimelineUnifiedFetch(url: string): boolean {
  try {
    const parsed = new URL(url, 'http://local.test')
    // Exact /api/timeline — not /api/timeline/projects, /stats, etc.
    return /\/api\/timeline\/?$/.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * Count classified fetches against the mount budget. Returns over-budget keys.
 */
export function findMountFetchBudgetViolations(urls: readonly string[]): string[] {
  let unified = 0
  for (const url of urls) {
    if (isTimelineUnifiedFetch(url)) unified += 1
  }
  const violations: string[] = []
  if (unified > TIMELINE_MOUNT_FETCH_BUDGET.timelineUnified) {
    violations.push(`timeline unified: ${unified} > ${TIMELINE_MOUNT_FETCH_BUDGET.timelineUnified}`)
  }
  return violations
}
