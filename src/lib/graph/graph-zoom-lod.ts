import { COMMUNITY_LEVEL_SCHEMA } from './community-levels'
import { communityCircleFromPositions } from './community-hull'

export type GraphZoomLodMode = 'nodes' | 'clusters'

export type GraphZoomCluster = {
  id: string
  level: number
  name: string
  description: string | null
  cx: number
  cy: number
  r: number
  memberCount: number
}

export type GraphZoomLodCommunity = {
  id: string
  level: number
  name: string
  description: string | null
  memberEntityIds: string[]
}

export type GraphZoomLodNodePosition = {
  id: string
  x: number
  y: number
  label?: string
}

/** Touch / coarse-pointer devices benefit from earlier clustering. */
export function isCoarsePointerGraphDevice(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(pointer: coarse)').matches) return true
  return navigator.maxTouchPoints > 0
}

/** Halve scale thresholds so nodes stay visible ~2× further when zooming out. */
const GRAPH_ZOOM_LOD_DELAY_FACTOR = 0.5

const CLUSTER_ENTER_COARSE = 0.82 * GRAPH_ZOOM_LOD_DELAY_FACTOR
const CLUSTER_EXIT_COARSE = 0.96 * GRAPH_ZOOM_LOD_DELAY_FACTOR
const CLUSTER_ENTER_FINE = 0.58 * GRAPH_ZOOM_LOD_DELAY_FACTOR
const CLUSTER_EXIT_FINE = 0.72 * GRAPH_ZOOM_LOD_DELAY_FACTOR

/** Scale below which the coarsest community level is used. */
export const GRAPH_ZOOM_CLUSTER_LEVEL_0_MAX = 0.34 * GRAPH_ZOOM_LOD_DELAY_FACTOR
/** Scale below which the middle community level is used. */
export const GRAPH_ZOOM_CLUSTER_LEVEL_1_MAX = 0.54 * GRAPH_ZOOM_LOD_DELAY_FACTOR

/** Hysteresis avoids flicker when the user pinches around the threshold. */
export function graphZoomLodMode(
  scale: number,
  coarsePointer: boolean,
  previousMode: GraphZoomLodMode,
): GraphZoomLodMode {
  const enter = coarsePointer ? CLUSTER_ENTER_COARSE : CLUSTER_ENTER_FINE
  const exit = coarsePointer ? CLUSTER_EXIT_COARSE : CLUSTER_EXIT_FINE
  if (!Number.isFinite(scale) || scale <= 0) return 'clusters'
  if (previousMode === 'clusters') {
    return scale < exit ? 'clusters' : 'nodes'
  }
  return scale < enter ? 'clusters' : 'nodes'
}

/** Pick a coarser community level when zoomed further out. */
export function graphZoomClusterLevelForScale(
  scale: number,
  availableLevels: ReadonlyArray<number>,
): number | null {
  const levels = canonicalLevelsPresent(availableLevels)
  if (levels.length === 0) return null
  const finest = levels[0]
  const coarsest = levels[levels.length - 1]
  if (scale < GRAPH_ZOOM_CLUSTER_LEVEL_0_MAX) return levels.includes(0) ? 0 : coarsest
  if (scale < GRAPH_ZOOM_CLUSTER_LEVEL_1_MAX) return levels.includes(1) ? 1 : finest
  return finest
}

export function graphZoomClusterExitScale(coarsePointer: boolean): number {
  return coarsePointer ? CLUSTER_EXIT_COARSE : CLUSTER_EXIT_FINE
}

export function communityClustersForLevel(
  communities: ReadonlyArray<GraphZoomLodCommunity>,
  posById: ReadonlyMap<string, { x: number; y: number }>,
  level: number,
): GraphZoomCluster[] {
  const hulls: GraphZoomCluster[] = []
  for (const community of communities) {
    if (community.level !== level) continue
    const positions: { x: number; y: number }[] = []
    for (const entityId of community.memberEntityIds) {
      const p = posById.get(entityId)
      if (p) positions.push(p)
    }
    if (positions.length === 0) continue
    const circle = communityCircleFromPositions(positions, level === 0 ? 52 : 40)
    if (!circle) continue
    hulls.push({
      id: community.id,
      level: community.level,
      name: community.name,
      description: community.description,
      cx: circle.cx,
      cy: circle.cy,
      r: circle.r,
      memberCount: positions.length,
    })
  }
  return hulls.sort((a, b) => a.level - b.level)
}

/** Spatial fallback when consolidation communities are not available. */
export function spatialClustersFromNodes(
  nodes: ReadonlyArray<GraphZoomLodNodePosition>,
  cellSize: number,
): GraphZoomCluster[] {
  if (nodes.length === 0 || !Number.isFinite(cellSize) || cellSize <= 0) return []
  const buckets = new Map<string, GraphZoomLodNodePosition[]>()
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
    const gx = Math.floor(node.x / cellSize)
    const gy = Math.floor(node.y / cellSize)
    const key = `${gx}:${gy}`
    const list = buckets.get(key) ?? []
    list.push(node)
    buckets.set(key, list)
  }

  const clusters: GraphZoomCluster[] = []
  for (const [key, members] of buckets) {
    const positions = members.map((m) => ({ x: m.x, y: m.y }))
    const circle = communityCircleFromPositions(positions, 36)
    if (!circle) continue
    const label =
      members.length === 1 ? members[0].label?.trim() || members[0].id : `${members.length} nodes`
    clusters.push({
      id: `spatial:${key}`,
      level: -1,
      name: label.length > 42 ? `${label.slice(0, 40)}…` : label,
      description: null,
      cx: circle.cx,
      cy: circle.cy,
      r: circle.r,
      memberCount: members.length,
    })
  }
  return clusters
}

export function spatialClusterCellSizeForScale(scale: number, coarsePointer: boolean): number {
  const base = coarsePointer ? 110 : 90
  const factor = Math.max(0.35, Math.min(1.4, scale))
  return base / factor
}

export function clustersForZoomLod(
  communities: ReadonlyArray<GraphZoomLodCommunity>,
  nodes: ReadonlyArray<GraphZoomLodNodePosition>,
  scale: number,
  availableLevels: ReadonlyArray<number>,
  coarsePointer: boolean,
): GraphZoomCluster[] {
  const level = graphZoomClusterLevelForScale(scale, availableLevels)
  if (level !== null) {
    const posById = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }] as const))
    const fromCommunities = communityClustersForLevel(communities, posById, level)
    if (fromCommunities.length > 0) return fromCommunities
  }
  return spatialClustersFromNodes(nodes, spatialClusterCellSizeForScale(scale, coarsePointer))
}

export function graphClusterBadgeRadius(memberCount: number): number {
  return Math.min(28, 10 + Math.sqrt(Math.max(1, memberCount)) * 4)
}

function canonicalLevelsPresent(levelsInData: ReadonlyArray<number>): number[] {
  const present = new Set(levelsInData)
  return COMMUNITY_LEVEL_SCHEMA.filter((level) => present.has(level))
}
