import { base } from '$app/paths'
import type { ResolvedPathname } from '$app/types'

/**
 * Where a citation's open control leads: the thought page (ei "A thought, up close",
 * `/thought/[id]`, built by the wave after this one — see docs/planning/ei-redesign.md).
 *
 * Typed as `ResolvedPathname` so anchors satisfy `svelte/no-navigation-without-resolve`.
 * It is assembled from `base` by hand rather than via `resolve('/thought/[id]', …)` because
 * SvelteKit only types route ids that already exist; once the route lands this can become
 * a plain `resolve()` call with no change at the call sites.
 */
export function thoughtHref(id: string): ResolvedPathname {
  return `${base}/thought/${encodeURIComponent(id)}` as ResolvedPathname
}
