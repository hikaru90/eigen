/**
 * Forget, with an arm step (ei app.js:1473-1483): the first tap arms the control —
 * it reads "Forget for good?" — a second tap inside the window confirms, and the arm
 * drops by itself when the window passes. A runes store: the component renders
 * `armed`, calls `tap()` from its click handler and `dispose()` on unmount.
 * No `$effect` — every transition is a call from an event boundary or a timer the
 * store itself owns.
 */

/** ei app.js:1477 — how long "Forget for good?" stays armed. */
export const FORGET_ARM_MS = 3200

export type ForgetTap = 'armed' | 'confirmed'

export type ForgetArm = {
  readonly armed: boolean
  /** First tap arms; a second tap while armed confirms (and disarms). */
  tap(): ForgetTap
  disarm(): void
  dispose(): void
}

export function createForgetArm(opts: { armMs?: number } = {}): ForgetArm {
  const armMs = opts.armMs ?? FORGET_ARM_MS
  let armed = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function disarm(): void {
    clear()
    armed = false
  }

  function tap(): ForgetTap {
    if (armed) {
      disarm()
      return 'confirmed'
    }
    clear()
    armed = true
    timer = setTimeout(() => {
      timer = null
      armed = false
    }, armMs)
    return 'armed'
  }

  return {
    get armed() {
      return armed
    },
    tap,
    disarm,
    dispose: disarm,
  }
}
