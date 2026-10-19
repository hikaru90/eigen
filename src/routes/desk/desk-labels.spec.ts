import { describe, expect, it } from 'vitest'
import { deskLabelText, isLabelVisible, projectToScreen, type LabelViewport } from './desk-labels'

const VIEWPORT: LabelViewport = { width: 800, height: 600, marginPx: 24 }

describe('isLabelVisible', () => {
  it('is visible inside the viewport', () => {
    expect(isLabelVisible({ x: 400, y: 300 }, VIEWPORT)).toBe(true)
  })

  it('is visible within the margin band', () => {
    expect(isLabelVisible({ x: -10, y: 300 }, VIEWPORT)).toBe(true)
    expect(isLabelVisible({ x: 810, y: -20 }, VIEWPORT)).toBe(true)
  })

  it('is invisible beyond the margin band', () => {
    expect(isLabelVisible({ x: -25, y: 300 }, VIEWPORT)).toBe(false)
    expect(isLabelVisible({ x: 400, y: 625 }, VIEWPORT)).toBe(false)
    expect(isLabelVisible({ x: 900, y: 900 }, VIEWPORT)).toBe(false)
  })
})

describe('projectToScreen', () => {
  // Column-major 4x4 (WebGL convention), here an orthographic map:
  // x -> x, y -> y, z -> z.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

  it('maps NDC center to the viewport center', () => {
    const p = projectToScreen({ x: 0, y: 0, z: 0 }, identity, VIEWPORT.width, VIEWPORT.height)
    expect(p.screenX).toBeCloseTo(400)
    expect(p.screenY).toBeCloseTo(300)
    expect(p.behind).toBe(false)
  })

  it('maps NDC +1 x to the right edge and +1 y to the top edge', () => {
    const right = projectToScreen({ x: 1, y: 0, z: 0 }, identity, VIEWPORT.width, VIEWPORT.height)
    expect(right.screenX).toBeCloseTo(800)
    const top = projectToScreen({ x: 0, y: 1, z: 0 }, identity, VIEWPORT.width, VIEWPORT.height)
    expect(top.screenY).toBeCloseTo(0)
  })

  it('flags geometry behind the camera (clip w <= 0)', () => {
    // A view-projection whose w row is exactly -z (identity keeps the +1 offset).
    const m = [...identity]
    m[11] = -1
    m[15] = 0
    expect(projectToScreen({ x: 0, y: 0, z: 0.5 }, m, VIEWPORT.width, VIEWPORT.height).behind).toBe(
      true,
    )
    expect(projectToScreen({ x: 0, y: 0, z: -1 }, m, VIEWPORT.width, VIEWPORT.height).behind).toBe(
      false,
    )
  })

  it('applies a translation from a column-major matrix', () => {
    // Translate by (0.5, 0, 0): column-major means tx is index 12.
    const translated = [...identity]
    translated[12] = 0.5
    const p = projectToScreen({ x: 0, y: 0, z: 0 }, translated, VIEWPORT.width, VIEWPORT.height)
    expect(p.screenX).toBeCloseTo(600)
  })
})

describe('deskLabelText', () => {
  it('returns short text unchanged', () => {
    expect(deskLabelText('Buy milk')).toBe('Buy milk')
  })

  it('truncates long text with an ellipsis', () => {
    const out = deskLabelText('a'.repeat(50), 42)
    expect(out).toHaveLength(41)
    expect(out.endsWith('…')).toBe(true)
  })

  it('trims whitespace before truncating', () => {
    expect(deskLabelText('  hi  ')).toBe('hi')
  })

  it('falls back to a placeholder for empty text', () => {
    expect(deskLabelText('   ')).toBe('—')
  })
})
