/**
 * A pattern's slice of the knowledge graph: the canonical entities its cited
 * thoughts mention (thought_entity — mirrored into AGE as MENTIONS) and the AGE
 * ENTITY_RELATES edges among them. Structure only; meaning was decided upstream.
 */

export type PatternGraphNode = { id: string; label: string; type: string }
export type PatternGraphEdge = { sourceId: string; targetId: string; predicate: string }
export type PatternGraph = { nodes: PatternGraphNode[]; edges: PatternGraphEdge[] }

export type PatternMention = { thoughtId: string; entityId: string; label: string; type: string }

/** The card's sketch stays legible: the most-mentioned entities only. */
export const PATTERN_GRAPH_MAX_NODES = 12

export function buildPatternGraph(
  thoughtIds: readonly string[],
  mentions: readonly PatternMention[],
  relations: readonly PatternGraphEdge[],
): PatternGraph {
  const cited = new Set(thoughtIds)
  const byEntity = new Map<string, { node: PatternGraphNode; thoughts: Set<string>; order: number }>()
  for (const m of mentions) {
    if (!cited.has(m.thoughtId)) continue
    const entry = byEntity.get(m.entityId) ?? {
      node: { id: m.entityId, label: m.label, type: m.type },
      thoughts: new Set<string>(),
      order: byEntity.size,
    }
    entry.thoughts.add(m.thoughtId)
    byEntity.set(m.entityId, entry)
  }

  const nodes = [...byEntity.values()]
    .sort((a, b) => b.thoughts.size - a.thoughts.size || a.order - b.order)
    .slice(0, PATTERN_GRAPH_MAX_NODES)
    .map((entry) => entry.node)

  const ids = new Set(nodes.map((node) => node.id))
  const seen = new Set<string>()
  const edges: PatternGraphEdge[] = []
  for (const r of relations) {
    if (!ids.has(r.sourceId) || !ids.has(r.targetId) || r.sourceId === r.targetId) continue
    const key = `${r.sourceId}\u0000${r.targetId}\u0000${r.predicate}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(r)
  }
  return { nodes, edges }
}
