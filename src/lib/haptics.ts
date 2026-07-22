/**
 * Haptic feedback utilities using the Web Vibration API.
 *
 * The Vibration API is only available on some mobile browsers (Android Chrome, etc.)
 * and is not supported on iOS Safari. All functions are SSR-safe and no-ops when
 * the API is unavailable.
 *
 * Calls must happen synchronously inside a user-gesture handler (click, pointerup, etc.).
 * Async callbacks such as setTimeout will be ignored by the browser.
 */

export type HapticEnvironment = {
  apiAvailable: boolean
  secureContext: boolean
  hint: string
}

export type HapticTestResult = {
  requested: boolean
  accepted: boolean
  hint: string
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

function vibrate(value: number | number[]): boolean {
  if (!canVibrate()) return false
  try {
    return navigator.vibrate(value)
  } catch {
    return false
  }
}

/**
 * Describe whether haptics can run in the current browser context.
 */
export function getHapticEnvironment(): HapticEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      apiAvailable: false,
      secureContext: false,
      hint: 'Not running in a browser.',
    }
  }

  const secureContext = window.isSecureContext
  const apiAvailable = canVibrate()

  if (!apiAvailable) {
    return {
      apiAvailable: false,
      secureContext,
      hint: !secureContext
        ? 'This page is not a secure context. Use HTTPS, or on a phone over USB run: adb reverse tcp:5173 tcp:5173 then open http://localhost:5173 on the device.'
        : 'navigator.vibrate is unavailable here. iOS Safari never vibrates from the web; use Android Chrome.',
    }
  }

  return {
    apiAvailable: true,
    secureContext,
    hint: 'API available. Test on a real Android device (not desktop). Turn off silent/DND and enable touch haptics in system settings.',
  }
}

/**
 * Trigger a noticeable test pulse. Must be called from a click/tap handler.
 */
export function testHapticFeedback(): HapticTestResult {
  const env = getHapticEnvironment()
  if (!env.apiAvailable) {
    return { requested: false, accepted: false, hint: env.hint }
  }

  const accepted = vibrate(60)
  return {
    requested: true,
    accepted,
    hint: accepted
      ? 'Browser accepted the vibration request. If you still felt nothing, check Android sound profile (not silent) and Settings → Vibration & haptics → Touch feedback.'
      : 'Browser rejected the request. Tap this button directly; background tabs and some embedded browsers block vibration.',
  }
}

/**
 * Trigger a short haptic pulse for button presses and UI interactions.
 *
 * @param durationMs - Vibration duration in milliseconds (default: 25ms).
 */
export function hapticPress(durationMs = 25): boolean {
  return vibrate(durationMs)
}

/**
 * Trigger a medium haptic pulse for confirmations or toggles.
 *
 * @param durationMs - Vibration duration in milliseconds (default: 40ms).
 */
export function hapticConfirm(durationMs = 40): boolean {
  return vibrate(durationMs)
}

/**
 * Trigger a pattern of vibrations for errors or warnings.
 *
 * @param pattern - Array of alternating vibration and pause durations in ms.
 *                  Default: short double-pulse [30, 60, 30].
 */
export function hapticError(pattern: number[] = [30, 60, 30]): boolean {
  return vibrate(pattern)
}

/**
 * Check if the Vibration API is available in the current environment.
 */
export function isVibrationSupported(): boolean {
  return canVibrate()
}
