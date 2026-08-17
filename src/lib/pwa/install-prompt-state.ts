/**
 * Client-side snooze / re-prompt state for the PWA install banner.
 *
 * Mirrors the localStorage-per-user pattern of `first-capture-nudge.ts`.
 * No server column: install state is inherently per-browser (you install on
 * one device, not "globally"), so a DB migration would add no value here.
 *
 * Cadence: show → on dismiss, snooze 24h → after 3 dismissals, stop nagging.
 * Permanent kill switch when the user installs or picks "never ask again".
 */

/** Snooze window before re-prompting after a dismissal. */
export const INSTALL_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000
/** After this many dismissals, stop surfacing the banner automatically. */
export const INSTALL_PROMPT_MAX_DISMISSALS = 3

export function installPromptPermDismissedKey(userId: string): string {
  return `eigenmesh:pwa_install_perm_dismissed:${userId}`
}

export function installPromptLastShownKey(userId: string): string {
  return `eigenmesh:pwa_install_last_shown:${userId}`
}

export function installPromptDismissCountKey(userId: string): string {
  return `eigenmesh:pwa_install_dismiss_count:${userId}`
}

/** True when the user installed or explicitly chose "never ask again". */
export function isInstallPromptPermanentlyDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(installPromptPermDismissedKey(userId)) === '1'
  } catch {
    return false
  }
}

export function getInstallPromptDismissCount(userId: string): number {
  try {
    const raw = localStorage.getItem(installPromptDismissCountKey(userId))
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function getInstallPromptLastShown(userId: string): number | null {
  try {
    const raw = localStorage.getItem(installPromptLastShownKey(userId))
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Stamp "shown now" so the snooze clock starts. */
export function recordInstallPromptShown(userId: string, now: number = Date.now()): void {
  try {
    localStorage.setItem(installPromptLastShownKey(userId), String(now))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Increment the dismissal counter and reset the snooze clock. */
export function recordInstallPromptDismissal(userId: string, now: number = Date.now()): void {
  try {
    const count = getInstallPromptDismissCount(userId) + 1
    localStorage.setItem(installPromptDismissCountKey(userId), String(count))
    localStorage.setItem(installPromptLastShownKey(userId), String(now))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Permanent kill switch — installed or "never ask again". */
export function recordInstallPromptPermanentDismissal(userId: string): void {
  try {
    localStorage.setItem(installPromptPermDismissedKey(userId), '1')
  } catch {
    /* ignore quota / private mode */
  }
}

export type ShouldShowInstallPromptOptions = {
  /** Result of `isPwaStandalone()` — already installed / running as PWA. */
  isStandalone: boolean
  /** Injected clock for deterministic tests; defaults to `Date.now()`. */
  now?: number
  /** Override snooze window (ms). Defaults to 24h. */
  snoozeMs?: number
  /** Override the dismissal cap. Defaults to 3. */
  maxDismissals?: number
}

/**
 * Pure decision: should the install banner render right now?
 * Standalone and permanent-dismissal short-circuit first; then the
 * snooze/cap cadence applies.
 */
export function shouldShowInstallPrompt(
  userId: string,
  options: ShouldShowInstallPromptOptions,
): boolean {
  if (options.isStandalone) return false
  if (isInstallPromptPermanentlyDismissed(userId)) return false
  const maxDismissals = options.maxDismissals ?? INSTALL_PROMPT_MAX_DISMISSALS
  if (getInstallPromptDismissCount(userId) >= maxDismissals) return false
  const now = options.now ?? Date.now()
  const snoozeMs = options.snoozeMs ?? INSTALL_PROMPT_SNOOZE_MS
  const last = getInstallPromptLastShown(userId)
  if (last === null) return true // never prompted yet
  return now - last >= snoozeMs
}
