import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BeforeInstallPromptEvent } from '$lib/pwa/install'

type Listener = (event: Event) => void

function fakePrompt(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome }),
  })
  return event
}

function stubWindow(early: BeforeInstallPromptEvent | null = null) {
  const listeners = new Map<string, Listener[]>()
  const win = {
    __eigenInstallPrompt: early,
    matchMedia: () => ({ matches: false }),
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== fn),
      )
    },
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('navigator', {})
  return {
    fire(type: string, event: Event) {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
  }
}

async function loadStore() {
  vi.resetModules()
  return import('./deferred-install-store.svelte')
}

describe('deferred install store', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('picks up an install prompt that fired before the app mounted', async () => {
    const early = fakePrompt('accepted')
    stubWindow(early)
    const store = await loadStore()
    store.initDeferredInstallStore()
    expect(store.deferredInstallState.deferred).toBe(early)
  })

  it('still captures a prompt that fires after mount', async () => {
    const win = stubWindow(null)
    const store = await loadStore()
    store.initDeferredInstallStore()
    expect(store.deferredInstallState.deferred).toBeNull()
    const late = fakePrompt('accepted')
    win.fire('beforeinstallprompt', late)
    expect(store.deferredInstallState.deferred).toBe(late)
  })

  it('installApp opens the native dialog once and marks the app installed on accept', async () => {
    const early = fakePrompt('accepted')
    stubWindow(early)
    const store = await loadStore()
    store.initDeferredInstallStore()

    await expect(store.installApp()).resolves.toBe('accepted')
    expect(early.prompt).toHaveBeenCalledTimes(1)
    expect(store.deferredInstallState.deferred).toBeNull()
    expect(store.deferredInstallState.installed).toBe(true)
  })

  it('installApp reports a dismissal and consumes the prompt (browsers allow one prompt per event)', async () => {
    const early = fakePrompt('dismissed')
    stubWindow(early)
    const store = await loadStore()
    store.initDeferredInstallStore()

    await expect(store.installApp()).resolves.toBe('dismissed')
    expect(store.deferredInstallState.deferred).toBeNull()
    expect(store.deferredInstallState.installed).toBe(false)
  })

  it('installApp is unavailable when the browser never offered a prompt', async () => {
    stubWindow(null)
    const store = await loadStore()
    store.initDeferredInstallStore()
    await expect(store.installApp()).resolves.toBe('unavailable')
  })
})
