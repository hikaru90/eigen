import { activeNavId } from '$lib/components/chrome/nav-active'

/**
 * Offline reading (board: "the app should be offline first"). The service worker keeps
 * the last copy of the core pages — Capture, Mesh, Ask and a thought up close — and the
 * hashed build assets they need, so the app opens and shows what you last saw without a
 * connection. New captures already wait in the capture queue; every other change needs
 * a connection. The page cache holds personal data and is wiped on sign-out.
 */
export const PAGE_CACHE = 'eigen-pages-v1'
export const ASSET_CACHE = 'eigen-assets-v1'
export const PAGE_CACHE_MAX_ENTRIES = 80
export const ASSET_CACHE_MAX_ENTRIES = 400
/** Where an offline launch lands when the requested page was never loaded. */
export const OFFLINE_LANDING_PATH = '/capture'

/** Service worker → page: where the last page response came from. */
export type PageSourceMessage = { type: 'page-source'; source: 'network' | 'cache' }

/**
 * asset: hashed build file, cache first. page: a core page or its data, network first and
 * stored. navigation: any other page load — never stored, but offline it lands on Capture
 * (the installed app starts at /login, which redirects there when online).
 */
export type OfflineRequestKind = 'asset' | 'page' | 'navigation'

const DATA_SUFFIX = '/__data.json'
const SVELTEKIT_PARAMS = ['x-sveltekit-invalidated', 'x-sveltekit-trailing-slash']

/** Which cache a request belongs to, or null when the service worker leaves it alone. */
export function classifyOfflineRequest(
  request: { url: string; method: string; mode: RequestMode },
  origin: string,
): OfflineRequestKind | null {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.origin !== origin) return null
  if (url.pathname.startsWith('/_app/immutable/')) return 'asset'

  const isData = url.pathname.endsWith(DATA_SUFFIX)
  if (!isData && request.mode !== 'navigate') return null
  const pagePath = isData ? url.pathname.slice(0, -DATA_SUFFIX.length) || '/' : url.pathname
  // only the core loop's surfaces are stored — utility, auth and admin pages need the server
  if (activeNavId(pagePath)) return 'page'
  return isData ? null : 'navigation'
}

/** One cached copy per page: SvelteKit's invalidation params do not change what it shows. */
export function pageCacheKey(url: string): string {
  const parsed = new URL(url)
  for (const param of SVELTEKIT_PARAMS) parsed.searchParams.delete(param)
  return parsed.href
}

/** Only a plain same-origin 200 is a page worth keeping — never an error or a redirect to login. */
export function isStorableResponse(response: {
  ok: boolean
  status: number
  type: ResponseType
  redirected: boolean
}): boolean {
  return response.ok && response.status === 200 && response.type === 'basic' && !response.redirected
}

/** Cache keys come back oldest first; the ones past `max` are deleted. */
export function trimOrder<T>(keys: readonly T[], max: number): T[] {
  return keys.length > max ? keys.slice(0, keys.length - max) : []
}

/** What the offline line says: no connection, a stored copy shown, or nothing. */
export function offlineNotice(state: {
  online: boolean
  fromCache: boolean
}): 'offline' | 'stale' | null {
  if (!state.online) return 'offline'
  return state.fromCache ? 'stale' : null
}
