/**
 * Shared, app-wide capture of the browser `beforeinstallprompt` event.
 *
 * Problem this solves: Chrome/Edge fires `beforeinstallprompt` once per
 * session, asynchronously, only when the app is installable. If a component
 * mounts its own listener after the event already fired (or unmounts before
 * it fires), the deferred event is lost until the next page load. By
 * capturing it once at the layout root, every consumer (the onboarding
 * overlay, the install toast) reads the same deferred event.
 *
 * Initialize exactly once from the authenticated layout `onMount` via
 * `initDeferredInstallStore()`; it wires `beforeinstallprompt` +
 * `appinstalled` listeners and returns a cleanup function.
 */
import {
  isPwaStandalone,
  listenForAppInstalled,
  listenForInstallPrompt,
  type BeforeInstallPromptEvent,
} from '$lib/pwa/install'

export const deferredInstallState = $state({
  /** The captured `beforeinstallprompt` event, or null if not yet fired / not supported. */
  deferred: null as BeforeInstallPromptEvent | null,
  /** True once the app is running in standalone / installed display mode. */
  installed: false,
})

let initialized = false

/** Current standalone state (reads the live browser, not the cached flag). */
export function isInstalled(): boolean {
  return deferredInstallState.installed || isPwaStandalone()
}

/** Consume the deferred event to trigger the native install dialog. */
export function takeDeferredInstall(): BeforeInstallPromptEvent | null {
  const event = deferredInstallState.deferred
  return event
}

/** Clear the deferred event (after it has been prompted and resolved). */
export function clearDeferredInstall(): void {
  deferredInstallState.deferred = null
}

/**
 * Wire the app-wide install listeners. Call once from the authenticated
 * layout `onMount`. Returns a cleanup function to remove the listeners.
 * Safe to call on the server (no-op) and idempotent on the client.
 */
export function initDeferredInstallStore(): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (initialized) return () => undefined
  initialized = true

  deferredInstallState.installed = isPwaStandalone()

  const stopPrompt = listenForInstallPrompt((event) => {
    deferredInstallState.deferred = event
  })
  const stopInstalled = listenForAppInstalled(() => {
    deferredInstallState.installed = true
    deferredInstallState.deferred = null
  })

  return () => {
    stopPrompt()
    stopInstalled()
    initialized = false
  }
}
