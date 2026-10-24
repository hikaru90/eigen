import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHapticEnvironment,
  hapticConfirm,
  hapticError,
  hapticPress,
  isVibrationSupported,
  testHapticFeedback,
} from './haptics'

/** A minimal DOM where `<input switch>` exists (Safari 17.4+) and label clicks are recorded. */
function stubSwitchDom() {
  const clicks: string[] = []
  const nodes: Record<string, unknown>[] = []
  class FakeInput {}
  Object.defineProperty(FakeInput.prototype, 'switch', { value: false, writable: true })
  const document = {
    body: { appendChild: (n: Record<string, unknown>) => nodes.push(n) },
    createElement: (tag: string) => {
      const el: Record<string, unknown> = {
        tag,
        style: {},
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
        click: () => clicks.push(tag),
      }
      return el
    },
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('HTMLInputElement', FakeInput)
  return { clicks, nodes }
}

describe('haptics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('no-ops when neither vibrate nor the iOS switch exists', () => {
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

  it('on iOS (no vibrate, <input switch> supported) ticks a hidden switch instead', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', { isSecureContext: true })
    const { clicks, nodes } = stubSwitchDom()
    const haptics = await import('./haptics')

    expect(haptics.hapticPress()).toBe(true)
    expect(haptics.hapticConfirm()).toBe(true)
    expect(clicks).toEqual(['label', 'label'])
    // one hidden switch, created once and reused
    expect(nodes).toHaveLength(1)
    expect(haptics.getHapticEnvironment()).toMatchObject({ apiAvailable: true, channel: 'switch' })
  })

  it('reports insecure context when no channel exists', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', { isSecureContext: false })

    expect(getHapticEnvironment()).toEqual({
      apiAvailable: false,
      channel: 'none',
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
