/** Client helpers for the global currentUserView filter. */

import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'

export type CurrentUserView = 'user' | 'all' | string

export type AuthorLayerMatchItem = {
  author: 'user' | 'agent'
  authorLabel?: string | null
  authorKeyId?: string | null
}

export const CURRENT_USER_VIEW_STORAGE_KEY = 'current-user-view'
export const LEGACY_TIMELINE_AUTHOR_FILTER_KEY = 'timeline-author-filter'

/** Stable filter-layer key for a memory row (mirrors server authorLayerKeyFromThought). */
export function authorLayerKeyFromItem(item: AuthorLayerMatchItem): string {
  if (item.author !== 'agent') return 'user'
  if (item.authorKeyId) return `apikey:${item.authorKeyId}`
  const label = item.authorLabel?.trim()
  if (label) return `label:${label}`
  return 'user'
}

export function isValidCurrentUserView(
  view: string,
  authorLayers: readonly AuthorLayerMeta[],
): view is CurrentUserView {
  if (view === 'user' || view === 'all') return true
  return authorLayers.some((layer) => layer.key === view)
}

export function resolveInitialCurrentUserView(
  authorLayers: readonly AuthorLayerMeta[],
): CurrentUserView {
  if (typeof localStorage === 'undefined') return 'user'

  const stored = localStorage.getItem(CURRENT_USER_VIEW_STORAGE_KEY)
  if (stored && isValidCurrentUserView(stored, authorLayers)) {
    return stored
  }

  const legacy = localStorage.getItem(LEGACY_TIMELINE_AUTHOR_FILTER_KEY)
  if (legacy === 'user') return 'user'
  if (legacy === 'all') return 'all'
  if (legacy === 'agent') {
    const firstAgent = authorLayers.find((layer) => layer.kind === 'agent')
    return firstAgent?.key ?? 'all'
  }

  return 'user'
}

export function viewLabel(view: CurrentUserView, authorLayers: readonly AuthorLayerMeta[]): string {
  if (view === 'all') return 'Everything'
  const layer = authorLayers.find((l) => l.key === view)
  if (layer) return layer.label
  return view === 'user' ? 'You' : view
}

export function viewKind(
  view: CurrentUserView,
  authorLayers: readonly AuthorLayerMeta[],
): 'user' | 'agent' {
  if (view === 'user') return 'user'
  if (view === 'all') return 'user'
  const layer = authorLayers.find((l) => l.key === view)
  return layer?.kind === 'agent' ? 'agent' : 'user'
}

/** Empty set = show all layers (graph/embeddings convention). */
export function viewToVisibleAuthorLayers(view: CurrentUserView): Set<string> {
  if (view === 'all') return new Set()
  if (view === 'user') return new Set(['user'])
  return new Set([view])
}

/** Coarse MemoryAuthor for list APIs when authorLayerKey is not used. */
export function viewToMemoryAuthor(view: CurrentUserView): 'user' | 'agent' | undefined {
  if (view === 'user') return 'user'
  if (view === 'all') return undefined
  return 'agent'
}

/** Layer key for per-agent API filtering; null means use coarse author or no filter. */
export function viewAuthorLayerKey(view: CurrentUserView): string | null {
  if (view === 'user' || view === 'all') return null
  return view
}

/** Query params for list APIs (temporal events, capture recent, text files). */
export function viewToListApiParams(view: CurrentUserView): {
  author?: 'user' | 'agent'
  authorLayerKey?: string
} {
  if (view === 'user') return { author: 'user' }
  if (view === 'all') return {}
  return { authorLayerKey: view }
}

export function appendViewToSearchParams(params: URLSearchParams, view: CurrentUserView): void {
  const api = viewToListApiParams(view)
  if (api.authorLayerKey) {
    params.set('authorLayerKey', api.authorLayerKey)
    return
  }
  if (api.author === 'user') {
    params.set('author', 'user')
  }
}

export function matchesCurrentUserView(item: AuthorLayerMatchItem, view: CurrentUserView): boolean {
  if (view === 'all') return true
  return authorLayerKeyFromItem(item) === view
}
