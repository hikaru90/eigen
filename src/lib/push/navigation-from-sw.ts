import { goto } from '$app/navigation'

const PUSH_NAVIGATE_TYPE = 'PUSH_NAVIGATE'

type PushNavigateMessage = {
  type: typeof PUSH_NAVIGATE_TYPE
  url: string
}

function isPushNavigateMessage(data: unknown): data is PushNavigateMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    'type' in data &&
    (data as { type?: unknown }).type === PUSH_NAVIGATE_TYPE &&
    'url' in data &&
    typeof (data as { url?: unknown }).url === 'string' &&
    (data as { url: string }).url.trim().length > 0
  )
}

/** Handles in-app navigation when the service worker focuses an existing window. */
export function startPushNavigationFromServiceWorker(): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {}
  }

  const onMessage = (event: MessageEvent) => {
    if (!isPushNavigateMessage(event.data)) return
    void goto(event.data.url)
  }

  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
