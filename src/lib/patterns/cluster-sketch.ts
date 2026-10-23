/**
 * Cluster sketch for a pattern card (ei redesign wave 2.4).
 *
 * "A thought is a square": one of the mark's soft squares per thought, laid in a
 * tight phyllotaxis spiral, joined by the logo's fine centre-to-centre links
 * (ei app.js buildMap, styles.css .map-svg .node/.edge). Pure and deterministic
 * — the card's SVG is derived from the pattern's thoughtIds alone, so the sketch
 * comes for free from data we already have. The full living map is a later pass.
 */

/** Every knot is the icons' square: 4.4 CSS px, never larger (DESIGN.md). */
export const CLUSTER_SKETCH_NODE_SIZE = 4.4
/** Golden angle — the same spiral the prototype's clusters use. */
const GOLDEN_ANGLE = 2.39996
/** Radial step: squares sit close but never touch. */
const SPREAD = 9

export type ClusterSketchNode = {
  x: number
  y: number
  size: number
  corner: number
}

export type ClusterSketchLink = {
  /** Index of the later node. */
  a: number
  /** Index of the earlier node it ties back to. */
  b: number
}

export type ClusterSketch = {
  nodes: ClusterSketchNode[]
  links: ClusterSketchLink[]
  /** Centred box that contains every square (with a little air). */
  bounds: { width: number; height: number }
}

export function clusterSketchLayout(ids: readonly string[]): ClusterSketch {
  const nodes: ClusterSketchNode[] = ids.map((_id, i) => {
    const r = SPREAD * Math.sqrt(i + 0.5)
    const angle = i * GOLDEN_ANGLE
    return {
      x: round(Math.cos(angle) * r),
      y: round(Math.sin(angle) * r),
      size: CLUSTER_SKETCH_NODE_SIZE,
      corner: CLUSTER_SKETCH_NODE_SIZE * 0.25,
    }
  })

  // Each square ties to its nearest earlier square: a tree, no loops, n-1 links.
  const links: ClusterSketchLink[] = []
  for (let i = 1; i < nodes.length; i++) {
    let nearest = 0
    let best = Number.POSITIVE_INFINITY
    for (let j = 0; j < i; j++) {
      const d = (nodes[j].x - nodes[i].x) ** 2 + (nodes[j].y - nodes[i].y) ** 2
      if (d < best) {
        best = d
        nearest = j
      }
    }
    links.push({ a: i, b: nearest })
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
