import type { CurrentUserView } from '$lib/memory/current-user-view'

/**
 * `currentUserView.subscribe` fires immediately with the current value.
 * `onMount` already seeds the recent list from prefetched server data and then
 * reloads it with the active view filter, so the initial subscribe echo must
 * not trigger a second load. Subsequent emissions (real view changes) refetch.
 */
export function shouldRefetchRecentForViewChange(
  previous: CurrentUserView | null,
  next: CurrentUserView,
): boolean {
  if (previous === null) return false
  return previous !== next
}
