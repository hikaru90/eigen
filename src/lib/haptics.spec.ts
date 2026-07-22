import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHapticEnvironment,
  hapticConfirm,
  hapticError,
  hapticPress,
  isVibrationSupported,
  testHapticFeedback,
} from './haptics'

describe('haptics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('no-ops when navigator.vibrate is unavailable', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', { isSecureContext: true })
    expect(isVibrationSupported()).toBe(false)
    expect(hapticPress()).toBe(false)
    expect(hapticConfirm()).toBe(false)
    expect(hapticError()).toBe(false)
  })

  it('calls navigator.vibrate with expected durations', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    vi.stubGlobal('window', { isSecureContext: true })

    expect(hapticPress()).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(25)

    expect(hapticConfirm()).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(40)

    expect(hapticError()).toBe(true)
    expect(vibrate).toHaveBeenCalledWith([30, 60, 30])
  })

  it('reports insecure context when vibrate is missing', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', { isSecureContext: false })

    expect(getHapticEnvironment()).toEqual({
      apiAvailable: false,
      secureContext: false,
      hint: expect.stringContaining('secure context'),
    })
  })

  it('testHapticFeedback uses a longer pulse', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    vi.stubGlobal('window', { isSecureContext: true })

    const result = testHapticFeedback()
    expect(result.requested).toBe(true)
    expect(result.accepted).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(60)
  })
})
