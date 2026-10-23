import { base } from '$app/paths'
import type { ResolvedPathname } from '$app/types'

/**
 * In-app hrefs for the thought page, typed `ResolvedPathname` so `goto()` and anchors
 * satisfy `svelte/no-navigation-without-resolve` (the same idiom as
 * src/lib/chat/thought-href.ts: assembled from `base` by hand because the leave target
 * and the Ask hand-off carry runtime query strings).
 */
export function inAppHref(path: string): ResolvedPathname {
  return `${base}${path}` as ResolvedPathname
}

/** An echo's open control: the echo's own page, remembering where the user came from. */
export function echoHref(thoughtId: string, from: string): ResolvedPathname {
  return inAppHref(`/thought/${encodeURIComponent(thoughtId)}?from=${encodeURIComponent(from)}`)
}
