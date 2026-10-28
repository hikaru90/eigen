import { describe, expect, it } from 'vitest'
import { classifyOfflineRequest, isStorableResponse, pageCacheKey, trimOrder } from './page-cache'

const ORIGIN = 'https://app.eigenmesh.xyz'
const get = (path: string, mode: RequestMode = 'cors') => ({
  url: `${ORIGIN}${path}`,
  method: 'GET',
  mode,
})

describe('classifyOfflineRequest', () => {
  it('serves hashed build assets from the asset cache', () => {
    expect(classifyOfflineRequest(get('/_app/immutable/chunks/abc.js'), ORIGIN)).toBe('asset')
  })

  it('keeps the core pages and their data readable offline', () => {
    for (const path of ['/capture', '/mesh/yarn', '/mesh/threads', '/chat', '/thought/abc']) {
      expect(classifyOfflineRequest(get(path, 'navigate'), ORIGIN)).toBe('page')
      expect(classifyOfflineRequest(get(`${path}/__data.json`), ORIGIN)).toBe('page')
    }
  })

  it('lets other navigations land on Capture offline, without storing them (the PWA starts at /login)', () => {
    for (const path of ['/login', '/', '/settings', '/admin']) {
      expect(classifyOfflineRequest(get(path, 'navigate'), ORIGIN)).toBe('navigation')
    }
  })

  it('never touches writes, API calls, utility data or other origins', () => {
    expect(classifyOfflineRequest({ ...get('/capture', 'navigate'), method: 'POST' }, ORIGIN)).toBe(
      null,
    )
    for (const path of ['/api/board', '/api/auth/get-session']) {
      expect(classifyOfflineRequest(get(path), ORIGIN)).toBe(null)
    }
    expect(classifyOfflineRequest(get('/settings/__data.json'), ORIGIN)).toBe(null)
    expect(
      classifyOfflineRequest(
        { url: 'https://cdn.example/x.js', method: 'GET', mode: 'cors' },
        ORIGIN,
      ),
    ).toBe(null)
  })
})

describe('pageCacheKey', () => {
  it('drops SvelteKit invalidation params so one page has one cached copy', () => {
    expect(pageCacheKey(`${ORIGIN}/capture/__data.json?x-sveltekit-invalidated=01`)).toBe(
      `${ORIGIN}/capture/__data.json`,
    )
  })

  it('keeps params that choose what the page shows', () => {
    expect(pageCacheKey(`${ORIGIN}/chat?session=s1`)).toBe(`${ORIGIN}/chat?session=s1`)
  })
})

describe('isStorableResponse', () => {
  const ok = { ok: true, status: 200, type: 'basic' as ResponseType, redirected: false }
  it('stores a plain same-origin 200', () => {
    expect(isStorableResponse(ok)).toBe(true)
  })
  it('never stores errors, redirects (e.g. to login) or opaque responses', () => {
    expect(isStorableResponse({ ...ok, ok: false, status: 500 })).toBe(false)
    expect(isStorableResponse({ ...ok, redirected: true })).toBe(false)
    expect(isStorableResponse({ ...ok, type: 'opaque' })).toBe(false)
  })
})

describe('trimOrder', () => {
  it('names the oldest entries past the limit for deletion', () => {
    expect(trimOrder(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b'])
    expect(trimOrder(['a'], 2)).toEqual([])
  })
})

describe('offlineNotice', () => {
  it('says offline when the device has no connection', async () => {
    const { offlineNotice } = await import('./page-cache')
    expect(offlineNotice({ online: false, fromCache: false })).toBe('offline')
    expect(offlineNotice({ online: false, fromCache: true })).toBe('offline')
  })

  it('says the page is a stored copy when the server could not be reached', async () => {
    const { offlineNotice } = await import('./page-cache')
    expect(offlineNotice({ online: true, fromCache: true })).toBe('stale')
  })

  it('says nothing when the page is live', async () => {
    const { offlineNotice } = await import('./page-cache')
    expect(offlineNotice({ online: true, fromCache: false })).toBe(null)
  })
})
