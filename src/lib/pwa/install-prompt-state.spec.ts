import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALL_PROMPT_MAX_DISMISSALS,
  INSTALL_PROMPT_SNOOZE_MS,
  getInstallPromptDismissCount,
  getInstallPromptLastShown,
  installPromptDismissCountKey,
  installPromptLastShownKey,
  installPromptPermDismissedKey,
  isInstallPromptPermanentlyDismissed,
  recordInstallPromptDismissal,
  recordInstallPromptPermanentDismissal,
  recordInstallPromptShown,
  shouldShowInstallPrompt,
} from '$lib/pwa/install-prompt-state'

/** Minimal localStorage stub keyed by string. */
function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
  }
}

describe('install-prompt-state', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('key functions', () => {
    it('scopes keys per user id', () => {
      expect(installPromptPermDismissedKey('u1')).toBe('eigenmesh:pwa_install_perm_dismissed:u1')
      expect(installPromptLastShownKey('u2')).toBe('eigenmesh:pwa_install_last_shown:u2')
      expect(installPromptDismissCountKey('u2')).toBe('eigenmesh:pwa_install_dismiss_count:u2')
    })
  })

  describe('permanent dismissal', () => {
    it('is false by default', () => {
      expect(isInstallPromptPermanentlyDismissed('u1')).toBe(false)
    })

    it('becomes true after recording permanent dismissal', () => {
      recordInstallPromptPermanentDismissal('u1')
      expect(isInstallPromptPermanentlyDismissed('u1')).toBe(true)
    })
  })

  describe('dismissal counter', () => {
    it('starts at zero', () => {
      expect(getInstallPromptDismissCount('u1')).toBe(0)
    })

    it('increments on each dismissal', () => {
      recordInstallPromptDismissal('u1', 1000)
      recordInstallPromptDismissal('u1', 2000)
      expect(getInstallPromptDismissCount('u1')).toBe(2)
    })

    it('records the last-shown timestamp alongside the count', () => {
      recordInstallPromptDismissal('u1', 12345)
      expect(getInstallPromptDismissCount('u1')).toBe(1)
      expect(getInstallPromptLastShown('u1')).toBe(12345)
    })

    it('tolerates a corrupted count value', () => {
      storage.setItem(installPromptDismissCountKey('u1'), 'not-a-number')
      expect(getInstallPromptDismissCount('u1')).toBe(0)
    })
  })

  describe('shouldShowInstallPrompt', () => {
    it('shows when never prompted and not standalone', () => {
      expect(shouldShowInstallPrompt('u1', { isStandalone: false, now: 1000 })).toBe(true)
    })

    it('never shows when already running standalone', () => {
      expect(shouldShowInstallPrompt('u1', { isStandalone: true, now: 1000 })).toBe(false)
    })

    it('never shows when permanently dismissed', () => {
      recordInstallPromptPermanentDismissal('u1')
      expect(shouldShowInstallPrompt('u1', { isStandalone: false, now: 1000 })).toBe(false)
    })

    it('snoozes for the configured window after being shown', () => {
      recordInstallPromptShown('u1', 1000)
      // within the snooze window
      expect(
        shouldShowInstallPrompt('u1', {
          isStandalone: false,
          now: 1000 + INSTALL_PROMPT_SNOOZE_MS - 1,
        }),
      ).toBe(false)
      // exactly at the window boundary -> eligible again
      expect(
        shouldShowInstallPrompt('u1', {
          isStandalone: false,
          now: 1000 + INSTALL_PROMPT_SNOOZE_MS,
        }),
      ).toBe(true)
    })

    it('stops after the dismissal cap is reached', () => {
      // dismissed 3 times (the default cap)
      for (let i = 0; i < INSTALL_PROMPT_MAX_DISMISSALS; i++) {
        recordInstallPromptDismissal('u1', i * 1000)
      }
      expect(getInstallPromptDismissCount('u1')).toBe(INSTALL_PROMPT_MAX_DISMISSALS)
      // long after the last snooze window — still suppressed by the cap
      expect(
        shouldShowInstallPrompt('u1', {
          isStandalone: false,
          now: 1000 + INSTALL_PROMPT_SNOOZE_MS * 100,
        }),
      ).toBe(false)
    })

    it('re-prompts one final time just before the cap is hit', () => {
      // dismissed twice (one below cap) — snooze window elapsed
      recordInstallPromptDismissal('u1', 1000)
      recordInstallPromptDismissal('u1', 2000)
      expect(
        shouldShowInstallPrompt('u1', {
          isStandalone: false,
          now: 2000 + INSTALL_PROMPT_SNOOZE_MS,
        }),
      ).toBe(true)
    })

    it('respects custom snooze and cap overrides', () => {
      recordInstallPromptShown('u1', 0)
      expect(
        shouldShowInstallPrompt('u1', {
          isStandalone: false,
          now: 1000,
          snoozeMs: 2000,
          maxDismissals: 10,
        }),
      ).toBe(false)
      expect(
        shouldShowInstallPrompt('u1', {
          isStandalone: false,
          now: 2000,
          snoozeMs: 2000,
          maxDismissals: 10,
        }),
      ).toBe(true)
    })
  })
})
