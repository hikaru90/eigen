/** Client-safe author layer filter helpers for graph and embeddings. */

export type AuthorLayerMeta = {
  key: string
  label: string
  kind: 'user' | 'agent'
}

export type AuthorLayerFilterNode = {
  kind?: string
  authorLayerKey?: string
  authorLayerKeys?: string[]
}

export type AuthorLayerFilterEdge = {
  sourceId: string
  targetId: string
  kind: string
}

function nodeLayerKeys(node: AuthorLayerFilterNode): string[] {
  if (node.kind === 'Thought' && node.authorLayerKey) {
    return [node.authorLayerKey]
  }
  return node.authorLayerKeys ?? ['user']
}

function edgeCoMentionKey(edge: AuthorLayerFilterEdge): string {
  const a = edge.sourceId
  const b = edge.targetId
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** Empty visibleLayers = show all; otherwise keep nodes whose layers intersect. */
export function filterNodesByAuthorLayers<T extends AuthorLayerFilterNode>(
  nodes: T[],
  visibleLayers: ReadonlySet<string>,
): T[] {
  if (visibleLayers.size === 0) return nodes
  return nodes.filter((node) => nodeLayerKeys(node).some((key) => visibleLayers.has(key)))
}

export function isEmbeddingItemVisibleByAuthorLayers(
  item: AuthorLayerFilterNode,
  visibleLayers: ReadonlySet<string>,
): boolean {
  if (visibleLayers.size === 0) return true
  return nodeLayerKeys(item).some((key) => visibleLayers.has(key))
}

/** Filter edges by author layers; entity_relation edges require both endpoints visible. */
export function filterEdgesByAuthorLayers<T extends AuthorLayerFilterEdge>(
  edges: T[],
  visibleLayers: ReadonlySet<string>,
  coMentionEdgeLayerKeys: Readonly<Record<string, string[]>>,
  visibleNodeIds: ReadonlySet<string>,
): T[] {
  if (visibleLayers.size === 0) return edges
  return edges.filter((edge) => {
    if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) {
      return false
    }
    if (edge.kind === 'entity_relation') return true
    const layers = coMentionEdgeLayerKeys[edgeCoMentionKey(edge)] ?? []
    return layers.some((key) => visibleLayers.has(key))
  })
}
