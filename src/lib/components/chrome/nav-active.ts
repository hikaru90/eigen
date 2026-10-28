export type BottomNavId = 'capture' | 'mesh' | 'ask'

/** Route prefixes owned by each bottom-nav item (pathnames are base-normalized). */
const NAV_PREFIXES: ReadonlyArray<readonly [BottomNavId, string]> = [
  ['capture', '/capture'],
  ['mesh', '/mesh'],
  // the entire graph is opened from Mesh ("Show entire graph")
  ['mesh', '/graph'],
  ['ask', '/chat'],
]

/**
 * Which bottom-nav item a pathname lights, if any. `/thought/[id]` (a thought up
 * close) belongs to Mesh — it is opened from the yarn. Utility surfaces (/settings,
 * /api-keys, /activity, /feedback, …) light nothing, per DESIGN.md: none of the
 * three menu items is lit outside the core loop.
 */
export function activeNavId(pathname: string): BottomNavId | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (path === '/thought' || path.startsWith('/thought/')) return 'mesh'
  for (const [id, prefix] of NAV_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return id
  }
  return null
}

/**
 * Where each bottom-nav item goes. Mesh points at its landing lens directly: `/mesh`
 * only redirects to `/mesh/yarn`, which cost a tap a second round trip.
 */
export const BOTTOM_NAV_HREFS = {
  capture: '/capture',
  mesh: '/mesh/yarn',
  ask: '/chat',
} as const satisfies Record<BottomNavId, string>

/**
 * The item the bottom nav lights: the tab being navigated to while its page loads,
 * otherwise the current one — so a tap answers at once instead of after the load.
 */
export function displayedNavId(
  currentPathname: string,
  pendingPathname: string | null,
): BottomNavId | null {
  return activeNavId(pendingPathname ?? currentPathname)
}

/** The bottom nav's mark for `id` — the landing point for motion aimed at a tab (the capture fly). */
export function navMarkSelector(id: BottomNavId): string {
  return `[data-nav-mark="${id}"]`
}
