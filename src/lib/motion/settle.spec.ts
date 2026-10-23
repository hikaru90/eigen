import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EASE,
  FLIGHT_EASE,
  GHOST_EASE,
  condenseDelay,
  flightControl,
  flightFrames,
  flyThought,
  gatherCenter,
  prefersReducedMotion,
  quadPoint,
  releaseGhostWords,
  splitGhostWords,
  yarnTrail,
  type Rect,
} from './settle'

describe('settle — motion constants (ei app.js:9, 478, 540)', () => {
  it('keeps the prototype easings', () => {
    expect(EASE).toBe('cubic-bezier(.22,1,.36,1)')
    expect(FLIGHT_EASE).toBe('cubic-bezier(.6,0,.2,1)')
    expect(GHOST_EASE).toBe('cubic-bezier(.5,0,.2,1)')
  })
})

describe('settle — prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false without throwing when matchMedia is unavailable (SSR/node)', () => {
    expect(typeof globalThis.matchMedia).toBe('undefined')
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reads the prefers-reduced-motion media query when available', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true }),
    )
    expect(prefersReducedMotion()).toBe(true)
    expect(globalThis.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})

describe('settle — flight geometry (ei app.js:516-548)', () => {
  it('computes the control point: midpoint pushed +70 x, 30% of the way down the vertical span', () => {
    expect(flightControl(0, 0, 100, 50)).toEqual({ x: 120, y: 15 })
    expect(flightControl(400, 700, 400, 40)).toEqual({ x: 470, y: 502 })
  })

  it('quadPoint hits the endpoints at t=0/1 and the quadratic midpoint at t=.5', () => {
    const c = { x: 120, y: 15 }
    expect(quadPoint(0, 0, c.x, c.y, 100, 50, 0)).toEqual({ x: 0, y: 0 })
    expect(quadPoint(0, 0, c.x, c.y, 100, 50, 1)).toEqual({ x: 100, y: 50 })
    const mid = quadPoint(0, 0, c.x, c.y, 100, 50, 0.5)
    expect(mid.x).toBeCloseTo(0.25 * 0 + 0.5 * 120 + 0.25 * 100, 6)
    expect(mid.y).toBeCloseTo(0.25 * 0 + 0.5 * 15 + 0.25 * 50, 6)
  })

  it('flightFrames walks the quadratic bezier from the gather point to the target', () => {
    const frames = flightFrames(10, 20, 110, 70, { x: 120, y: 15 })
    expect(frames).toHaveLength(29)
    expect(frames[0]).toBe('translate(10px, 20px) scale(1)')
    expect(frames[28]).toBe('translate(110px, 70px) scale(0.7)')
    const half = quadPoint(10, 20, 120, 15, 110, 70, 0.5)
    expect(frames[14]).toBe(
      `translate(${+(half.x).toFixed(2)}px, ${+(half.y).toFixed(2)}px) scale(0.85)`,
    )
  })
})

describe('settle — released words (ei app.js:447-481)', () => {
  it('gatherCenter returns the center of the words bounding box', () => {
    const rects: Rect[] = [
      { left: 0, right: 10, top: 0, bottom: 10 },
      { left: 20, right: 30, top: 4, bottom: 14 },
    ]
    expect(gatherCenter(rects)).toEqual({ x: 15, y: 7 })
  })

  it('condenseDelay staggers words 16ms apart and caps at 240ms', () => {
    expect(condenseDelay(0)).toBe(0)
    expect(condenseDelay(10)).toBe(160)
    expect(condenseDelay(100)).toBe(240)
  })

  it('splitGhostWords keeps words and whitespace as ordered tokens', () => {
    expect(splitGhostWords('a b  c\n!')).toEqual([
      { kind: 'word', text: 'a' },
      { kind: 'space', text: ' ' },
      { kind: 'word', text: 'b' },
      { kind: 'space', text: '  ' },
      { kind: 'word', text: 'c' },
      { kind: 'space', text: '\n' },
      { kind: 'word', text: '!' },
    ])
    expect(splitGhostWords('')).toEqual([])
  })
})

describe('settle — DOM helpers are safe outside the browser', () => {
  it('yarnTrail is a no-op without a document', () => {
    expect(() => yarnTrail(0, 0, 10, 10, 20, 20)).not.toThrow()
  })

  it('flyThought snaps straight to onArrive when it cannot animate', () => {
    const onArrive = vi.fn()
    const fakeTarget = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) }
    flyThought({ x: 5, y: 5 }, fakeTarget as unknown as Element, { onArrive })
    expect(onArrive).toHaveBeenCalledTimes(1)
  })

  it('releaseGhostWords returns null without a document', () => {
    const fakeSource = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    }
    expect(releaseGhostWords(fakeSource as unknown as HTMLElement, 'a word')).toBeNull()
  })
})
