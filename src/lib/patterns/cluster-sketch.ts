import type { PatternGraph } from './pattern-graph'

/**
 * Cluster sketch for a pattern card: the pattern's own slice of the knowledge graph.
 *
 * One of the mark's soft squares per graph entity the pattern's thoughts mention,
 * laid in a tight phyllotaxis spiral, joined by the logo's fine centre-to-centre
 * links — exactly the graph's relations among them, never invented ones (ei app.js
 * buildMap, styles.css .map-svg .node/.edge). Pure and deterministic.
 */

/** Every knot is the icons' square: 4.4 CSS px, never larger (DESIGN.md). */
export const CLUSTER_SKETCH_NODE_SIZE = 4.4
/** Golden angle — the same spiral the prototype's clusters use. */
const GOLDEN_ANGLE = 2.39996
/** Radial step: squares sit close but never touch. */
const SPREAD = 9

export type ClusterSketchNode = {
  id: string
  label: string
  x: number
  y: number
  size: number
  corner: number
}

export type ClusterSketchLink = {
  /** Index of the edge's source node. */
  a: number
  /** Index of the edge's target node. */
  b: number
}

export type ClusterSketch = {
  nodes: ClusterSketchNode[]
  links: ClusterSketchLink[]
  /** Centred box that contains every square (with a little air). */
  bounds: { width: number; height: number }
}

export function clusterSketchLayout(graph: PatternGraph): ClusterSketch {
  const nodes: ClusterSketchNode[] = graph.nodes.map((node, i) => {
    const r = SPREAD * Math.sqrt(i + 0.5)
    const angle = i * GOLDEN_ANGLE
    return {
      id: node.id,
      label: node.label,
      x: round(Math.cos(angle) * r),
      y: round(Math.sin(angle) * r),
      size: CLUSTER_SKETCH_NODE_SIZE,
      corner: CLUSTER_SKETCH_NODE_SIZE * 0.25,
    }
  })

  const indexById = new Map(nodes.map((node, i) => [node.id, i]))
  const links: ClusterSketchLink[] = []
  for (const edge of graph.edges) {
    const a = indexById.get(edge.sourceId)
    const b = indexById.get(edge.targetId)
    if (a !== undefined && b !== undefined) links.push({ a, b })
  }

  let reach = 0
  for (const node of nodes) {
    reach = Math.max(reach, Math.abs(node.x) + node.size / 2, Math.abs(node.y) + node.size / 2)
  }
  const half = Math.ceil(reach + 3) || 8
  return { nodes, links, bounds: { width: half * 2, height: half * 2 } }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
