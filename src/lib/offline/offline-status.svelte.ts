import { PAGE_CACHE, type PageSourceMessage } from './page-cache'

/** The device's connection and whether the page on screen is a stored copy. */
export const offlineStatus = $state({ online: true, fromCache: false })

function isPageSourceMessage(data: unknown): data is PageSourceMessage {
  return !!data && typeof data === 'object' && (data as { type?: unknown }).type === 'page-source'
}

/** Call once from the root layout's onMount; returns the cleanup. */
export function startOfflineStatus(): () => void {
  offlineStatus.online = navigator.onLine
  const setOnline = () => (offlineStatus.online = true)
  const setOffline = () => (offlineStatus.online = false)
  const onWorkerMessage = (event: MessageEvent) => {
    if (isPageSourceMessage(event.data)) offlineStatus.fromCache = event.data.source === 'cache'
  }
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
  navigator.serviceWorker?.addEventListener('message', onWorkerMessage)
  return () => {
    window.removeEventListener('online', setOnline)
    window.removeEventListener('offline', setOffline)
    navigator.serviceWorker?.removeEventListener('message', onWorkerMessage)
  }
}

/** The stored pages hold personal data: gone on sign-out and whenever nobody is signed in. */
export async function clearOfflinePageCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  await caches.delete(PAGE_CACHE)
}
