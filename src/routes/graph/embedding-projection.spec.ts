import { describe, expect, it } from 'vitest'
import {
  canRunUmap,
  centerAndScaleCoords3d,
  computeUmapNeighbors,
  fallbackProjection2d,
  fallbackProjection3d,
} from './embedding-projection'

describe('computeUmapNeighbors', () => {
  it('never exceeds itemCount - 1', () => {
    for (const n of [3, 5, 10, 50, 370, 800]) {
      expect(computeUmapNeighbors(n)).toBeLessThanOrEqual(n - 1)
    }
  })

  it('uses 1 neighbor for a single item', () => {
    expect(computeUmapNeighbors(1)).toBe(1)
  })
})

describe('canRunUmap', () => {
  it('rejects datasets UMAP cannot embed', () => {
    expect(canRunUmap(1, 1)).toBe(false)
    expect(canRunUmap(2, 1)).toBe(false)
    expect(canRunUmap(3, 2)).toBe(true)
  })
})

describe('fallbackProjection2d', () => {
  it('returns one coordinate per item', () => {
    expect(fallbackProjection2d(1)).toEqual([[0, 0]])
    expect(fallbackProjection2d(2)).toHaveLength(2)
    expect(fallbackProjection2d(5)).toHaveLength(5)
  })
})

describe('fallbackProjection3d', () => {
  it('returns one 3D coordinate per item', () => {
    expect(fallbackProjection3d(1)).toEqual([[0, 0, 0]])
    expect(fallbackProjection3d(2)).toHaveLength(2)
    expect(fallbackProjection3d(5)).toHaveLength(5)
    for (const coord of fallbackProjection3d(5)) {
      expect(coord).toHaveLength(3)
    }
  })

  it('is deterministic for the same item count', () => {
    expect(fallbackProjection3d(7)).toEqual(fallbackProjection3d(7))
  })
})

describe('centerAndScaleCoords3d', () => {
  it('centers a cloud at the origin with unit max radius', () => {
    const scaled = centerAndScaleCoords3d([
      [10, 0, 0],
      [-10, 0, 0],
    ])
    expect(scaled[0][0]).toBeCloseTo(1, 5)
    expect(scaled[1][0]).toBeCloseTo(-1, 5)
    expect(scaled[0][1]).toBeCloseTo(0, 5)
    expect(scaled[0][2]).toBeCloseTo(0, 5)
  })

  it('returns empty array for empty input', () => {
    expect(centerAndScaleCoords3d([])).toEqual([])
  })
})
