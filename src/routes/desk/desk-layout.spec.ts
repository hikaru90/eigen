import { describe, expect, it } from 'vitest'
import {
  createSeededRandom,
  deskGridCell,
  findPileAt,
  layoutLooseTasks,
  layoutProjectPiles,
  layoutWallNotes,
  pileSheetOffsets,
  type DeskBounds,
} from './desk-layout'

describe('createSeededRandom', () => {
  it('is deterministic for the same seed', () => {
    const a = createSeededRandom('pile-alpha')
    const b = createSeededRandom('pile-alpha')
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('differs between seeds', () => {
    const a = createSeededRandom('seed-one')
    const b = createSeededRandom('seed-two')
    const seqA = [a(), a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b(), b()]
    expect(seqA).not.toEqual(seqB)
  })

  it('returns values in [0, 1)', () => {
    const rand = createSeededRandom('range')
    for (let i = 0; i < 200; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('layoutProjectPiles', () => {
  const BOUNDS: DeskBounds = { minX: -6, maxX: 6, minZ: -3, maxZ: 3 }

  it('returns one centered placement for a single project', () => {
    const placements = layoutProjectPiles(['p1'], BOUNDS)
    expect(placements).toHaveLength(1)
    expect(placements[0].entityId).toBe('p1')
    expect(placements[0].x).toBeCloseTo(0, 5)
    expect(placements[0].z).toBeCloseTo(0, 5)
  })

  it('centers a single pile even on a very wide desk', () => {
    const wide: DeskBounds = { minX: -10.5, maxX: 10.5, minZ: -4.5, maxZ: 0.5 }
    const placements = layoutProjectPiles(['solo'], wide)
    expect(placements[0].x).toBeCloseTo(0, 5)
    expect(placements[0].z).toBeCloseTo(-2, 5)
  })

  it('returns one placement per project inside the bounds', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
    const placements = layoutProjectPiles(ids, BOUNDS)
    expect(placements).toHaveLength(ids.length)
    for (const placement of placements) {
      expect(ids).toContain(placement.entityId)
      expect(placement.x).toBeGreaterThanOrEqual(BOUNDS.minX)
      expect(placement.x).toBeLessThanOrEqual(BOUNDS.maxX)
      expect(placement.z).toBeGreaterThanOrEqual(BOUNDS.minZ)
      expect(placement.z).toBeLessThanOrEqual(BOUNDS.maxZ)
    }
  })

  it('is deterministic', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(layoutProjectPiles(ids, BOUNDS)).toEqual(layoutProjectPiles(ids, BOUNDS))
  })

  it('keeps distinct piles separated', () => {
    const placements = layoutProjectPiles(['a', 'b', 'c', 'd', 'e'], BOUNDS)
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const dist = Math.hypot(
          placements[i].x - placements[j].x,
          placements[i].z - placements[j].z,
        )
        expect(dist).toBeGreaterThan(0.5)
      }
    }
  })

  it('returns an empty array for no projects', () => {
    expect(layoutProjectPiles([], BOUNDS)).toEqual([])
  })
})

describe('pileSheetOffsets', () => {
  it('returns one offset per sheet', () => {
    expect(pileSheetOffsets(7, 'seed')).toHaveLength(7)
  })

  it('returns no offsets for an empty pile', () => {
    expect(pileSheetOffsets(0, 'seed')).toEqual([])
  })

  it('is deterministic per seed', () => {
    expect(pileSheetOffsets(5, 's')).toEqual(pileSheetOffsets(5, 's'))
    expect(pileSheetOffsets(5, 's')).not.toEqual(pileSheetOffsets(5, 't'))
  })

  it('keeps jitter and rotation within configured maxima', () => {
    const maxJitter = 0.06
    const maxRotation = 0.12
    const offsets = pileSheetOffsets(40, 'jitter', { maxJitter, maxRotation })
    for (const offset of offsets) {
      expect(Math.abs(offset.dx)).toBeLessThanOrEqual(maxJitter)
      expect(Math.abs(offset.dz)).toBeLessThanOrEqual(maxJitter)
      expect(Math.abs(offset.rot)).toBeLessThanOrEqual(maxRotation)
    }
  })

  it('stacks sheets upward by index', () => {
    const offsets = pileSheetOffsets(4, 'stack')
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i].y).toBeGreaterThan(offsets[i - 1].y)
    }
  })
})

describe('layoutLooseTasks', () => {
  it('lays tasks out in a row-major grid', () => {
    const placements = layoutLooseTasks(['t1', 't2', 't3', 't4', 't5'], { x: 10, z: 10 }, {
      cols: 3,
      spacing: 1,
    })
    expect(placements).toHaveLength(5)
    expect(placements[0].x).toBeCloseTo(9, 5)
    expect(placements[2].x).toBeCloseTo(11, 5)
    expect(placements[3].x).toBeCloseTo(9, 5)
    // Rows extend toward the viewer (larger z), away from the wall.
    expect(placements[3].z).toBeCloseTo(11, 5)
    expect(placements[4].z).toBeCloseTo(11, 5)
  })

  it('adds bounded rotation jitter deterministically', () => {
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6']
    const a = layoutLooseTasks(ids, { x: 0, z: 0 }, { cols: 3, spacing: 1, maxRotation: 0.15 })
    const b = layoutLooseTasks(ids, { x: 0, z: 0 }, { cols: 3, spacing: 1, maxRotation: 0.15 })
    expect(a).toEqual(b)
    for (const placement of a) {
      expect(Math.abs(placement.rotation)).toBeLessThanOrEqual(0.15)
    }
  })

  it('handles an empty task list', () => {
    expect(layoutLooseTasks([], { x: 0, z: 0 }, { cols: 3, spacing: 1 })).toEqual([])
  })
})

describe('layoutWallNotes', () => {
  it('arranges notes in a row-major grid within the wall bounds', () => {
    const wall = { width: 10, height: 6, y0: 0.5 }
    const placements = layoutWallNotes(['n1', 'n2', 'n3', 'n4'], wall, { cols: 2, spacing: 1 })
    expect(placements).toHaveLength(4)
    for (const p of placements) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(wall.width / 2)
      expect(p.y).toBeGreaterThanOrEqual(wall.y0)
      expect(p.y).toBeLessThanOrEqual(wall.y0 + wall.height)
    }
    // First row sits above the second row (y decreases downward).
    expect(placements[0].y).toBeGreaterThan(placements[2].y)
    expect(placements[0].x).toBeLessThan(placements[1].x)
  })

  it('is deterministic', () => {
    const ids = ['n1', 'n2', 'n3']
    const wall = { width: 8, height: 4, y0: 1 }
    expect(layoutWallNotes(ids, wall, { cols: 2, spacing: 1 })).toEqual(
      layoutWallNotes(ids, wall, { cols: 2, spacing: 1 }),
    )
  })

  it('returns an empty array for no notes', () => {
    expect(layoutWallNotes([], { width: 8, height: 4, y0: 1 }, { cols: 4, spacing: 1 })).toEqual([])
  })
})

describe('deskGridCell', () => {
  it('maps an index to row-major grid coordinates', () => {
    expect(deskGridCell(0, 3)).toEqual({ col: 0, row: 0 })
    expect(deskGridCell(2, 3)).toEqual({ col: 2, row: 0 })
    expect(deskGridCell(3, 3)).toEqual({ col: 0, row: 1 })
    expect(deskGridCell(5, 3)).toEqual({ col: 2, row: 1 })
  })
})

describe('findPileAt', () => {
  const placements = [
    { entityId: 'p1', x: 0, z: 0, sheetCount: 3 },
    { entityId: 'p2', x: 2, z: 0, sheetCount: 1 },
  ]

  it('finds the pile under a point', () => {
    expect(findPileAt(0.1, -0.1, placements, 0.5)?.entityId).toBe('p1')
    expect(findPileAt(2.2, 0.1, placements, 0.5)?.entityId).toBe('p2')
  })

  it('returns null when no pile is within radius', () => {
    expect(findPileAt(5, 5, placements, 0.5)).toBeNull()
  })

  it('prefers the closest pile when overlaps occur', () => {
    expect(findPileAt(1.2, 0, placements, 1.5)?.entityId).toBe('p2')
  })
})
