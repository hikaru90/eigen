export type BottomNavId = 'capture' | 'mesh' | 'ask'

/** Route prefixes owned by each bottom-nav item (pathnames are base-normalized). */
const NAV_PREFIXES: ReadonlyArray<readonly [BottomNavId, string]> = [
  ['capture', '/capture'],
  ['mesh', '/mesh'],
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
