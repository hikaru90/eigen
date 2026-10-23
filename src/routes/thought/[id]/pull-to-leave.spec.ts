import { describe, expect, it, vi } from 'vitest'
import {
  PULL_DAMPING,
  PULL_LEAVE_PX,
  pullLeaves,
  pullOffsetPx,
  pullOpacity,
  pullToLeave,
  type PullHost,
} from './pull-to-leave'

/**
 * Swipe down from the top to leave (ei app.js:1377-1397). The pull follows the finger
 * at 0.55, fades the card as it goes, and leaves once the finger has travelled 110 px.
 * It never fights scrolling: a pull only starts at the top, and never from a field.
 */
describe('pull arithmetic (ei app.js:1385-1396)', () => {
  it('damps the finger travel and never goes negative', () => {
    expect(PULL_DAMPING).toBe(0.55)
    expect(pullOffsetPx(100)).toBe(55)
    expect(pullOffsetPx(-30)).toBe(0)
    expect(pullOffsetPx(1)).toBe(0.6)
  })

  it('leaves past 110 px of finger travel', () => {
    expect(PULL_LEAVE_PX).toBe(110)
    expect(pullLeaves(110)).toBe(false)
    expect(pullLeaves(111)).toBe(true)
  })

  it('fades the card over 400 px of offset, clamped', () => {
    expect(pullOpacity(0)).toBe(1)
    expect(pullOpacity(200)).toBe(0.5)
    expect(pullOpacity(900)).toBe(0)
  })
})

type Listener = (event: TouchEvent) => void

/** A stand-in for the sheet element: just the surface the action touches. */
function fakeHost(opts: { scrolled?: boolean } = {}) {
  const listeners = new Map<string, Listener>()
  const props = new Map<string, string>()
  const classes = new Set<string>()
  const host: PullHost = {
    addEventListener: (type, fn) => listeners.set(type, fn as Listener),
    removeEventListener: (type) => listeners.delete(type),
    style: {
      setProperty: (name, value) => props.set(name, value),
      removeProperty: (name) => props.delete(name),
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    parentElement: opts.scrolled ? ({ scrollTop: 40, parentElement: null } as never) : null,
    scrollTop: 0,
  }
  const fire = (type: string, y: number, target: { tagName: string } = { tagName: 'DIV' }) => {
    const ev = {
      touches: [{ clientY: y }],
      cancelable: true,
      preventDefault: vi.fn(),
      target,
    } as unknown as TouchEvent
    listeners.get(type)?.(ev)
    return ev
  }
  return { host, fire, props, classes, listeners }
}

describe('pullToLeave action', () => {
  it('follows the finger, then leaves when the pull went far enough', () => {
    const onLeave = vi.fn()
    const { host, fire, props, classes } = fakeHost()
    const action = pullToLeave(host, { onLeave })

    fire('touchstart', 100)
    const move = fire('touchmove', 220)
    expect(move.preventDefault).toHaveBeenCalled()
    expect(classes.has('is-pulling')).toBe(true)
    expect(props.get('--pull')).toBe('66.0px')

    fire('touchend', 220)
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(classes.has('is-pulling')).toBe(false)
    action.destroy()
  })

  it('springs back when the pull was short', () => {
    const onLeave = vi.fn()
    const { host, fire, props, classes } = fakeHost()
    const action = pullToLeave(host, { onLeave })

    fire('touchstart', 100)
    fire('touchmove', 160)
    expect(props.get('--pull')).toBe('33.0px')
    fire('touchend', 160)
    expect(onLeave).not.toHaveBeenCalled()
    expect(props.has('--pull')).toBe(false)
    expect(classes.has('is-pulling')).toBe(false)
    action.destroy()
  })

  it('ignores upward travel and a touch that starts inside a field', () => {
    const onLeave = vi.fn()
    const { host, fire, props } = fakeHost()
    const action = pullToLeave(host, { onLeave })

    fire('touchstart', 100, { tagName: 'TEXTAREA' })
    fire('touchmove', 300)
    expect(props.has('--pull')).toBe(false)
    fire('touchend', 300)
    expect(onLeave).not.toHaveBeenCalled()

    fire('touchstart', 300)
    const up = fire('touchmove', 100)
    expect(up.preventDefault).not.toHaveBeenCalled()
    expect(props.get('--pull')).toBe('0.0px')
    fire('touchend', 100)
    expect(onLeave).not.toHaveBeenCalled()
    action.destroy()
  })

  it('never starts while the page is scrolled down', () => {
    const onLeave = vi.fn()
    const { host, fire, props } = fakeHost({ scrolled: true })
    const action = pullToLeave(host, { onLeave })
    fire('touchstart', 100)
    fire('touchmove', 400)
    expect(props.has('--pull')).toBe(false)
    fire('touchend', 400)
    expect(onLeave).not.toHaveBeenCalled()
    action.destroy()
  })

  it('can be switched off (while editing) and removes its listeners on destroy', () => {
    const onLeave = vi.fn()
    const { host, fire, listeners } = fakeHost()
    const action = pullToLeave(host, { onLeave, enabled: () => false })
    fire('touchstart', 100)
    fire('touchmove', 400)
    fire('touchend', 400)
    expect(onLeave).not.toHaveBeenCalled()
    expect(listeners.size).toBe(3)
    action.destroy()
    expect(listeners.size).toBe(0)
  })
})
