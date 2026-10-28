import {
  releaseCaptureQueueDrainLock,
  tryAcquireCaptureQueueDrainLock,
} from '$lib/capture/queue/db'
/// <reference lib="webworker" />
import { drainCaptureQueue } from '$lib/capture/queue/drain'
import { CAPTURE_QUEUE_SYNC_TAG, type CaptureQueueBroadcast } from '$lib/capture/queue/types'
import {
  ASSET_CACHE,
  ASSET_CACHE_MAX_ENTRIES,
  classifyOfflineRequest,
  isStorableResponse,
  OFFLINE_LANDING_PATH,
  PAGE_CACHE,
  PAGE_CACHE_MAX_ENTRIES,
  pageCacheKey,
  type PageSourceMessage,
  trimOrder,
} from '$lib/offline/page-cache'

const SW_DRAIN_LOCK_HOLDER = 'service-worker'

declare const self: ServiceWorkerGlobalScope

async function broadcastCaptureQueueMessage(
  message: CaptureQueueBroadcast | { type: 'capture-queue-idle' },
) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage(message)
  }
}

async function requestPageDrain(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'DRAIN_CAPTURE_QUEUE' })
  }
}

async function drainCaptureQueueInBackground(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const hasVisibleClient = clients.some(
    (c) => 'visibilityState' in c && c.visibilityState === 'visible',
  )
  if (hasVisibleClient) {
    await requestPageDrain()
    return
  }

  if (!(await tryAcquireCaptureQueueDrainLock(SW_DRAIN_LOCK_HOLDER))) {
    await requestPageDrain()
    return
  }

  try {
    await drainCaptureQueue({
      streamProgress: false,
      broadcast: (message) => broadcastCaptureQueueMessage(message),
    })
    await broadcastCaptureQueueMessage({ type: 'capture-queue-idle' })
  } finally {
    await releaseCaptureQueueDrainLock(SW_DRAIN_LOCK_HOLDER)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/* ————— offline reading (src/lib/offline/page-cache.ts) ————— */

async function storeInCache(cacheName: string, key: string, response: Response, max: number) {
  const cache = await caches.open(cacheName)
  await cache.put(key, response)
  const keys = await cache.keys()
  await Promise.all(trimOrder(keys, max).map((old) => cache.delete(old)))
}

async function tellClient(clientId: string, message: PageSourceMessage): Promise<void> {
  // a navigation has no client yet; tell every window instead
  const targets = clientId
    ? [await self.clients.get(clientId)]
    : await self.clients.matchAll({ type: 'window' })
  for (const client of targets) client?.postMessage(message)
}

/** Hashed build files never change: the cached copy is the copy. */
async function assetCacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request, { cacheName: ASSET_CACHE })
  if (cached) return cached
  const response = await fetch(request)
  if (isStorableResponse(response)) {
    await storeInCache(ASSET_CACHE, request.url, response.clone(), ASSET_CACHE_MAX_ENTRIES)
  }
  return response
}

/**
 * Pages always come from the server when it answers. Only when the request itself fails
 * (no connection) does the last stored copy stand in — and the page is told, so it can
 * say it is showing what you last saw.
 */
async function pageNetworkFirst(event: FetchEvent): Promise<Response> {
  const { request } = event
  const key = pageCacheKey(request.url)
  try {
    const response = await fetch(request)
    if (isStorableResponse(response)) {
      await storeInCache(PAGE_CACHE, key, response.clone(), PAGE_CACHE_MAX_ENTRIES)
    }
    void tellClient(event.clientId, { type: 'page-source', source: 'network' })
    return response
  } catch (err) {
    const cached = await caches.match(key, { cacheName: PAGE_CACHE })
    if (cached) {
      void tellClient(event.clientId, { type: 'page-source', source: 'cache' })
      return cached
    }
    return offlineLanding(request, err)
  }
}

/** An offline page load this cache cannot answer lands on Capture, if Capture was stored. */
async function offlineLanding(request: Request, err: unknown): Promise<Response> {
  const landing = new URL(OFFLINE_LANDING_PATH, self.location.origin).href
  if (request.mode === 'navigate' && (await caches.match(landing, { cacheName: PAGE_CACHE }))) {
    return Response.redirect(landing, 302)
  }
  throw err
}

/** Pages that are never stored (/login, /settings, …): the server, or offline the landing. */
async function navigationWithLanding(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch (err) {
    return offlineLanding(request, err)
  }
}

self.addEventListener('fetch', (event) => {
  const kind = classifyOfflineRequest(event.request, self.location.origin)
  if (kind === 'asset') event.respondWith(assetCacheFirst(event.request))
  else if (kind === 'page') event.respondWith(pageNetworkFirst(event))
  else if (kind === 'navigation') event.respondWith(navigationWithLanding(event.request))
})

self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent
  if (syncEvent.tag !== CAPTURE_QUEUE_SYNC_TAG) return
  syncEvent.waitUntil(drainCaptureQueueInBackground())
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (
    data &&
    typeof data === 'object' &&
    'type' in data &&
    (data as { type: string }).type === 'DRAIN_CAPTURE_QUEUE'
  ) {
    event.waitUntil(drainCaptureQueueInBackground())
  }
})

type PushPayload = {
  title?: string
  body?: string
  url?: string
  tag?: string
}

function parsePushPayload(event: PushEvent): PushPayload {
  if (!event.data) return {}
  try {
    const json = event.data.json() as unknown
    if (json && typeof json === 'object') return json as PushPayload
  } catch {
    const text = event.data.text()
    if (text.trim()) return { body: text }
  }
  return {}
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const title =
    typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Eigen Mesh'
  const body =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body
      : 'You have a new notification.'
  const tag = typeof payload.tag === 'string' && payload.tag.trim() ? payload.tag : 'eigen-push'
  const url = typeof payload.url === 'string' && payload.url.trim() ? payload.url : '/'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      icon: '/notification-icon.png',
      badge: '/notification-badge.png',
    }),
  )
})

function notificationTargetUrl(rawUrl: string): { href: string; path: string } {
  const target = new URL(rawUrl, self.location.origin)
  return {
    href: target.href,
    path: `${target.pathname}${target.search}${target.hash}`,
  }
}

async function focusClientAndNavigate(
  client: WindowClient,
  target: { href: string; path: string },
) {
  await client.focus()
  if ('navigate' in client && typeof client.navigate === 'function') {
    try {
      await client.navigate(target.href)
      return
    } catch {
      // Safari and older browsers: fall back to in-app navigation via postMessage.
    }
  }
  client.postMessage({ type: 'PUSH_NAVIGATE', url: target.path })
}

async function openNotificationUrl(rawUrl: string): Promise<void> {
  const target = notificationTargetUrl(rawUrl)
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

  for (const client of clients) {
    if (!client.url.startsWith(self.location.origin) || !('focus' in client)) continue
    await focusClientAndNavigate(client as WindowClient, target)
    return
  }

  await self.clients.openWindow(target.href)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url =
    event.notification.data &&
    typeof event.notification.data === 'object' &&
    'url' in event.notification.data &&
    typeof (event.notification.data as { url?: unknown }).url === 'string'
      ? (event.notification.data as { url: string }).url
      : '/'

  event.waitUntil(openNotificationUrl(url))
})
