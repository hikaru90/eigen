import type { CurrentUserView } from '$lib/memory/current-user-view'

/**
 * Query string for GET /api/mesh/yarn mirroring the global data view — the
 * same mapping buildTimelineApiUrl uses for /api/timeline: 'user' → author
 * filter, a specific agent layer → authorLayerKey, 'all' → the whole tenant.
 */
export function yarnApiUrlForView(view: CurrentUserView): string {
  const params = new URLSearchParams()
  if (view === 'user') {
    params.set('author', 'user')
  } else if (view === 'all') {
    params.set('author', 'all')
  } else {
    params.set('authorLayerKey', view)
  }
  return `/api/mesh/yarn?${params}`
}
