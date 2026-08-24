import { SvelteSet } from 'svelte/reactivity'
import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'
import {
  CURRENT_USER_VIEW_STORAGE_KEY,
  resolveInitialCurrentUserView,
  type CurrentUserView,
} from '$lib/memory/current-user-view'

export type { CurrentUserView }

/** Global data-view filter; survives client-side route changes. */
export const currentUserViewState = $state({
  view: 'user' as CurrentUserView,
})

type Listener = (view: CurrentUserView) => void
const listeners = new SvelteSet<Listener>()
let initialized = false

export function getCurrentUserView(): CurrentUserView {
  return currentUserViewState.view
}

export function setCurrentUserView(view: CurrentUserView): void {
  if (currentUserViewState.view === view) return
  currentUserViewState.view = view
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CURRENT_USER_VIEW_STORAGE_KEY, view)
  }
  for (const listener of listeners) listener(view)
}

/**
 * Subscribe to view changes. Fires immediately with the current value
 * (same contract as a Svelte writable store) so callers can skip the
 * initial echo via `shouldRefetchRecentForViewChange`.
 */
export function subscribeCurrentUserView(listener: Listener): () => void {
  listeners.add(listener)
  listener(currentUserViewState.view)
  return () => {
    listeners.delete(listener)
  }
}

/** Call once from layout when authorLayers are available. */
export function initCurrentUserViewStore(authorLayers: readonly AuthorLayerMeta[]): void {
  if (initialized || typeof localStorage === 'undefined') return
  initialized = true
  const initial = resolveInitialCurrentUserView(authorLayers)
  currentUserViewState.view = initial
  // Persist on subsequent changes only (setCurrentUserView writes localStorage).
  subscribeCurrentUserView((view) => {
    localStorage.setItem(CURRENT_USER_VIEW_STORAGE_KEY, view)
  })
}
