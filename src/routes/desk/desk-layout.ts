/** Deterministic layout math for the WebGL desk. Pure functions — no three.js, no DOM. */

export type DeskBounds = { minX: number; maxX: number; minZ: number; maxZ: number }

export type DeskPilePlacement = {
  entityId: string
  x: number
  z: number
  sheetCount: number
}

export type DeskSheetPlacement = {
  id: string
  x: number
  z: number
  rotation: number
}

export type DeskNotePlacement = {
  id: string
  x: number
  y: number
  rotation: number
}

export type DeskSheetOffset = { dx: number; dz: number; y: number; rot: number }

export type WallBounds = { width: number; height: number; y0: number }

/** xmur3 string hash feeding mulberry32 — deterministic per seed string. */
export function createSeededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = (h ^ (h >>> 16)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Row-major grid cell for an index. */
export function deskGridCell(index: number, cols: number): { col: number; row: number } {
  return { col: index % cols, row: Math.floor(index / cols) }
}

function gridCols(count: number, bounds: DeskBounds): number {
  const aspect = (bounds.maxX - bounds.minX) / Math.max(bounds.maxZ - bounds.minZ, 1e-6)
  // Never span more columns than there are items — a single pile must sit centered.
  return Math.max(1, Math.min(count, Math.round(Math.sqrt(count * Math.max(aspect, 0.25)))))
}

/**
 * Place one pile per project on the desk. Piles sit on a grid whose column
 * count follows the bounds aspect ratio, with small seeded jitter (skipped for
 * a single pile) so the arrangement reads as organic rather than robotic.
 */
export function layoutProjectPiles(entityIds: string[], bounds: DeskBounds): DeskPilePlacement[] {
  const count = entityIds.length
  if (count === 0) return []

  const cols = gridCols(count, bounds)
  const rows = Math.ceil(count / cols)
  const cellW = (bounds.maxX - bounds.minX) / cols
  const cellD = (bounds.maxZ - bounds.minZ) / rows
  const maxJitter = count === 1 ? 0 : Math.min(0.15 * Math.min(cellW, cellD), 0.35)
  const rand = createSeededRandom(`desk-piles:${entityIds.join('|')}`)

  return entityIds.map((entityId, i) => {
    const { col, row } = deskGridCell(i, cols)
    const jitterX = (rand() * 2 - 1) * maxJitter
    const jitterZ = (rand() * 2 - 1) * maxJitter
    return {
      entityId,
      x: bounds.minX + (col + 0.5) * cellW + jitterX,
      z: bounds.minZ + (row + 0.5) * cellD + jitterZ,
      sheetCount: 0,
    }
  })
}

/** Per-sheet jitter within a pile plus a fixed lift per index so sheets stack. */
export function pileSheetOffsets(
  count: number,
  seed: string,
  opts: { maxJitter?: number; maxRotation?: number; sheetLift?: number } = {},
): DeskSheetOffset[] {
  const { maxJitter = 0.06, maxRotation = 0.12, sheetLift = 0.018 } = opts
  const rand = createSeededRandom(`desk-pile:${seed}`)
  const offsets: DeskSheetOffset[] = []
  for (let i = 0; i < count; i++) {
    offsets.push({
      dx: (rand() * 2 - 1) * maxJitter,
      dz: (rand() * 2 - 1) * maxJitter,
      y: i * sheetLift,
      rot: (rand() * 2 - 1) * maxRotation,
    })
  }
  return offsets
}

/** Loose task sheets in a centered row-major grid; rows extend toward the viewer. */
export function layoutLooseTasks(
  ids: string[],
  origin: { x: number; z: number },
  opts: { cols: number; spacing: number; maxRotation?: number },
): DeskSheetPlacement[] {
  const { cols, spacing, maxRotation = 0.1 } = opts
  return ids.map((id, i) => {
    const { col, row } = deskGridCell(i, cols)
    const rand = createSeededRandom(`desk-task:${id}`)
    return {
      id,
      x: origin.x + (col - (cols - 1) / 2) * spacing,
      z: origin.z + row * spacing,
      rotation: (rand() * 2 - 1) * maxRotation,
    }
  })
}

/** Wall notes in a row-major grid that grows downward from the wall top. */
export function layoutWallNotes(
  ids: string[],
  wall: WallBounds,
  opts: { cols: number; spacing: number },
): DeskNotePlacement[] {
  const { cols, spacing } = opts
  return ids.map((id, i) => {
    const { col, row } = deskGridCell(i, cols)
    const rand = createSeededRandom(`desk-note:${id}`)
    const maxY = wall.y0 + wall.height
    return {
      id,
      x: (col - (cols - 1) / 2) * spacing,
      y: Math.min(maxY - (row + 0.5) * spacing, maxY),
      rotation: (rand() * 2 - 1) * 0.06,
    }
  })
}

/** Closest pile under a desk-space point, within `radius`; null when none. */
export function findPileAt(
  x: number,
  z: number,
  placements: DeskPilePlacement[],
  radius: number,
): DeskPilePlacement | null {
  let closest: DeskPilePlacement | null = null
  let closestDist = radius
  for (const placement of placements) {
    const dist = Math.hypot(placement.x - x, placement.z - z)
    if (dist <= closestDist) {
      closestDist = dist
      closest = placement
    }
  }
  return closest
}
