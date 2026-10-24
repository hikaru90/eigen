import type { CurrentUserView } from '$lib/memory/current-user-view'

/** The Mesh tabs whose list API follows the global data view. */
export type MeshViewTab = 'yarn' | 'threads'

/**
 * URL for a Mesh tab's list API mirroring the global data view (the header
 * dropdown) — the same mapping buildTimelineApiUrl uses for /api/timeline:
 * 'user' → author filter, a specific agent layer → authorLayerKey, 'all' →
 * the whole tenant.
 */
export function meshApiUrlForView(tab: MeshViewTab, view: CurrentUserView): string {
  const params = new URLSearchParams()
  if (view === 'user') {
    params.set('author', 'user')
  } else if (view === 'all') {
    params.set('author', 'all')
  } else {
    params.set('authorLayerKey', view)
  }
  return `/api/mesh/${tab}?${params}`
}
