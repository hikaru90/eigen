export type GraphVizNode = {
  id: string
  kind: 'Thought' | 'Entity'
  label: string
  subtype: string
}

export type GraphVizEdge = {
  id: string
  sourceId: string
  targetId: string
  relationType: string
  kind: string
}

function nodeKey(id: string): string {
  return id.trim().toLowerCase()
}

/** Drop edges whose endpoints are not present in `nodes` (D3 forceLink requires both). */
export function filterGraphVizEdgesToNodes(
  nodes: GraphVizNode[],
  edges: GraphVizEdge[],
): { nodes: GraphVizNode[]; edges: GraphVizEdge[] } {
  const nodeIds = new Set(nodes.map((n) => nodeKey(n.id)).filter((id) => id.length > 0))
  const safeEdges = edges.filter((e) => {
    const sourceId = nodeKey(e.sourceId)
    const targetId = nodeKey(e.targetId)
    return (
      sourceId.length > 0 &&
      targetId.length > 0 &&
      sourceId !== targetId &&
      nodeIds.has(sourceId) &&
      nodeIds.has(targetId)
    )
  })
  return { nodes, edges: safeEdges }
}

/** Resolve link endpoints to node objects so D3 never does a missing-id lookup. */
export function resolveForceLinks<T extends { id: string }>(
  nodes: T[],
  edges: Array<{
    id: string
    sourceId: string
    targetId: string
    relationType: string
    kind: string
  }>,
): Array<{
  id: string
  source: T
  target: T
  relationType: string
  kind: string
}> {
  const nodeByKey = new Map<string, T>()
  for (const node of nodes) {
    const key = nodeKey(node.id)
    if (key) nodeByKey.set(key, node)
  }

  const links: Array<{
    id: string
    source: T
    target: T
    relationType: string
    kind: string
  }> = []

  for (const edge of edges) {
    const source = nodeByKey.get(nodeKey(edge.sourceId))
    const target = nodeByKey.get(nodeKey(edge.targetId))
    if (!source || !target || source.id === target.id) continue
    links.push({
      id: edge.id,
      source,
      target,
      relationType: edge.relationType,
      kind: edge.kind,
    })
  }

  return links
}
