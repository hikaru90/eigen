/**
 * Haptic feedback for taps, confirmations and errors. Two channels:
 *
 * - `vibrate` — the Web Vibration API (Android Chrome and friends).
 * - `switch` — iOS Safari never implements vibrate, but since iOS 18 toggling an
 *   `<input type="checkbox" switch>` plays the system haptic tick. Detected by the
 *   element's `switch` property (Safari 17.4+), never by user agent; one hidden switch
 *   is created on first use and reused.
 *
 * All functions are SSR-safe and return false when no channel exists. Calls must
 * happen synchronously inside a user-gesture handler (click, pointerup, keydown);
 * async callbacks such as setTimeout are ignored by both channels.
 */

export type HapticChannel = 'vibrate' | 'switch' | 'none'

export type HapticEnvironment = {
  apiAvailable: boolean
  channel: HapticChannel
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

function canSwitchTick(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLInputElement !== 'undefined' &&
    'switch' in HTMLInputElement.prototype
  )
}

function hapticChannel(): HapticChannel {
  if (canVibrate()) return 'vibrate'
  if (canSwitchTick()) return 'switch'
  return 'none'
}

let switchLabel: { click(): void } | null = null

/** The hidden iOS switch: a label wrapping the input, so a label click toggles it. */
function switchTick(): boolean {
  if (!switchLabel) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.setAttribute('type', 'checkbox')
    input.setAttribute('switch', '')
    input.setAttribute('tabindex', '-1')
    label.setAttribute('aria-hidden', 'true')
    Object.assign(label.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      opacity: '0',
      pointerEvents: 'none',
      clipPath: 'inset(50%)',
    })
    label.appendChild(input)
    document.body.appendChild(label)
    switchLabel = label
  }
  switchLabel.click()
  return true
}

/** One pulse on whichever channel exists; the switch tick has one strength. */
function vibrate(value: number | number[]): boolean {
  const channel = hapticChannel()
  if (channel === 'switch') return switchTick()
  if (channel === 'none') return false
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
      channel: 'none',
      secureContext: false,
      hint: 'Not running in a browser.',
    }
  }

  const secureContext = window.isSecureContext
  const channel = hapticChannel()

  if (channel === 'switch') {
    return {
      apiAvailable: true,
      channel,
      secureContext,
      hint: 'iOS: haptics play through the system switch tick (iOS 18+). Turn on Settings → Sounds & Haptics → System Haptics.',
    }
  }

  if (channel === 'none') {
    return {
      apiAvailable: false,
      channel,
      secureContext,
      hint: !secureContext
        ? 'This page is not a secure context. Use HTTPS, or on a phone over USB run: adb reverse tcp:5173 tcp:5173 then open http://localhost:5173 on the device.'
        : 'No haptic channel here (no Vibration API, no iOS switch). Desktop browsers have none.',
    }
  }

  return {
    apiAvailable: true,
    channel,
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
 * Check if the Vibration API is available in the current environment (Android);
 * getHapticEnvironment().channel reports the iOS switch channel too.
 */
export function isVibrationSupported(): boolean {
  return canVibrate()
}
