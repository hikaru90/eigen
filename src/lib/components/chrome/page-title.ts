export type PageTitleLabels = {
  capture: string
  mesh: string
  ask: string
  contribute: string
  notifications: string
  summary: string
}

const SUFFIX = ' — Eigenmesh'

/**
 * The document title, owned by the root layout and derived from the route. Pages do
 * not set <title> themselves: on a route change the next page mounts before the last
 * one unmounts, and the leaving page's <title> teardown would put its own title back.
 */
export function pageTitle(path: string, thoughtText: string | null, labels: PageTitleLabels): string {
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  if (under('/thought') && thoughtText) return thoughtText.slice(0, 60)
  if (under('/capture')) return labels.capture + SUFFIX
  if (under('/mesh')) return labels.mesh + SUFFIX
  if (under('/chat')) return labels.ask + SUFFIX
  if (under('/feedback')) return labels.contribute + SUFFIX
  if (under('/notifications')) return labels.notifications + SUFFIX
  if (under('/summary')) return labels.summary + SUFFIX
  return 'Eigenmesh'
}
