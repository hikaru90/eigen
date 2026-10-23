import { describe, expect, it } from 'vitest'
import {
  ARC_PATH,
  MARK_CORNER,
  MARK_LINKS,
  MARK_LINK_WIDTH,
  MARK_TILES,
  MENU_CORNER,
  MENU_ICONS,
  MENU_LINK_WIDTH,
  MENU_SQ,
  SPINNER_PTS,
  SPINNER_R,
  linkPath,
  menuWavy,
  spinnerWavy,
  wavyArcPath,
  wavyPath,
  type Point,
} from './geometry'

/** Parse a flat 'Mx yLx y...' polyline into points (test-side only). */
function polyline(d: string): Point[] {
  const nums = d.split(/[ML]/).filter((chunk) => chunk.trim().length > 0)
  return nums.map((chunk) => {
    const [x, y] = chunk.trim().split(/\s+/).map(Number)
    return { x, y }
  })
}

describe('brand geometry — menu icons', () => {
  it('uses the prototype constants: 4.4px squares, 0.55 corner, 0.6px links', () => {
    expect(MENU_SQ).toBe(4.4)
    expect(MENU_CORNER).toBe(0.55)
    expect(MENU_LINK_WIDTH).toBe(0.6)
  })

  it('defines the resting icon geometry from ei assets/menu-icons.js:17-20', () => {
    expect(MENU_ICONS.capture.squares).toEqual([[0, 0]])
    expect(MENU_ICONS.capture.links).toEqual([])
    expect(MENU_ICONS.capture.arc).toBe(true)

    expect(MENU_ICONS.mesh.squares).toEqual([
      [-7.7, 0],
      [7.7, 0],
    ])
    expect(MENU_ICONS.mesh.links).toEqual([[0, 1]])

    expect(MENU_ICONS.ask.squares).toEqual([
      [0, -8.2],
      [-7.5, 6.6],
      [7.5, 6.6],
    ])
    expect(MENU_ICONS.ask.links).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ])
  })

  it('linkPath draws a straight center-to-center segment', () => {
    expect(linkPath([-7.7, 0], [7.7, 0])).toBe('M-7.7 0L7.7 0')
  })

  it('keeps the capture arc path from the prototype', () => {
    expect(ARC_PATH).toBe('M5.57 -5.57A7.88 7.88 0 1 0 5.57 5.57')
  })
})

describe('brand geometry — wavy yarn', () => {
  it('pins the wavy strand at both squares', () => {
    const a: [number, number] = [-7.7, 0]
    const b: [number, number] = [7.7, 0]
    const pts = polyline(menuWavy(a, b))
    expect(pts[0].x).toBeCloseTo(a[0], 2)
    expect(pts[0].y).toBeCloseTo(a[1], 2)
    expect(pts[pts.length - 1].x).toBeCloseTo(b[0], 2)
    expect(pts[pts.length - 1].y).toBeCloseTo(b[1], 2)
  })

  it('deviates no more than the amplitude and more than zero (it actually waves)', () => {
    const a: [number, number] = [-7.7, 0]
    const b: [number, number] = [7.7, 0]
    const pts = polyline(menuWavy(a, b))
    let maxOffset = 0
    for (const p of pts) maxOffset = Math.max(maxOffset, Math.abs(p.y))
    expect(maxOffset).toBeGreaterThan(0.2)
    expect(maxOffset).toBeLessThanOrEqual(0.75 + 0.01)
  })

  it('falls back to a straight line for degenerate lengths', () => {
    expect(menuWavy([1, 1], [1, 1])).toBe('M1 1L1 1')
  })

  it('spinnerWavy pins endpoints and uses the spinner wave (18 samples, amplitude 0.7)', () => {
    const pts = polyline(spinnerWavy(SPINNER_PTS[0], SPINNER_PTS[1]))
    expect(pts).toHaveLength(19) // M + 18 samples
    expect(pts[0].x).toBeCloseTo(SPINNER_PTS[0][0], 2)
    expect(pts[0].y).toBeCloseTo(SPINNER_PTS[0][1], 2)
    expect(pts[pts.length - 1].x).toBeCloseTo(SPINNER_PTS[1][0], 2)
    expect(pts[pts.length - 1].y).toBeCloseTo(SPINNER_PTS[1][1], 2)
    const direct = polyline(
      wavyPath(SPINNER_PTS[0], SPINNER_PTS[1], { amplitude: 0.7, waves: 2, samples: 18 }),
    )
    expect(pts).toEqual(direct)
  })

  it('wavyArcPath with wave 0 reproduces the prototype arc endpoints (5.57, ±5.57)', () => {
    const pts = polyline(wavyArcPath({ wave: 0 }))
    expect(pts[0].x).toBeCloseTo(5.57, 2)
    expect(pts[0].y).toBeCloseTo(-5.57, 2)
    expect(pts[pts.length - 1].x).toBeCloseTo(5.57, 2)
    expect(pts[pts.length - 1].y).toBeCloseTo(5.57, 2)
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(7.88, 1)
  })

  it('wavyArcPath with wave 1 displaces the strand while keeping the ends pinned', () => {
    const pts = polyline(wavyArcPath({ wave: 1 }))
    expect(pts[0].y).toBeCloseTo(-5.57, 2)
    expect(pts[pts.length - 1].y).toBeCloseTo(5.57, 2)
    const radii = pts.map((p) => Math.hypot(p.x, p.y))
    expect(Math.max(...radii)).toBeGreaterThan(7.9)
    expect(Math.max(...radii)).toBeLessThanOrEqual(7.88 + 0.75 + 0.01)
  })
})

describe('brand geometry — the mark', () => {
  it('has the approved six squares and seven links', () => {
    expect(MARK_TILES).toHaveLength(6)
    expect(MARK_LINKS).toHaveLength(7)
  })

  it('joins links center to center', () => {
    for (const [a, b] of MARK_LINKS) {
      expect(MARK_TILES[a]).toBeDefined()
      expect(MARK_TILES[b]).toBeDefined()
    }
  })

  it('fits the 8x8 viewBox and uses the prototype corner radius and link width', () => {
    expect(MARK_CORNER).toBe(0.14)
    expect(MARK_LINK_WIDTH).toBe(0.17)
    for (const [x, y, r] of MARK_TILES) {
      expect(x - r).toBeGreaterThanOrEqual(0)
      expect(x + r).toBeLessThanOrEqual(8)
      expect(y - r).toBeGreaterThanOrEqual(0)
      expect(y + r).toBeLessThanOrEqual(8)
    }
  })
})

describe('brand geometry — the spinner triangle', () => {
  it('is the ask icon triangle: R 6.6 with squares at ±(R*0.866) horizontally', () => {
    expect(SPINNER_R).toBe(6.6)
    expect(SPINNER_PTS[0]).toEqual([0, -6.6])
    expect(SPINNER_PTS[1][0]).toBeCloseTo(-6.6 * 0.866, 3)
    expect(SPINNER_PTS[1][1]).toBeCloseTo(3.3, 3)
    expect(SPINNER_PTS[2][0]).toBeCloseTo(6.6 * 0.866, 3)
    expect(SPINNER_PTS[2][1]).toBeCloseTo(3.3, 3)
  })
})
