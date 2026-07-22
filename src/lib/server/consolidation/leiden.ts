/**
 * Leiden community detection — pure TypeScript implementation.
 *
 * This is a simplified Louvain/Leiden-inspired modularity-maximizing algorithm
 * suitable for the entity graphs in this system (typically 10–5000 nodes).
 * It produces hierarchical community assignments at 3 levels (L2→L0).
 *
 * Algorithm outline:
 *   1. Start with each node in its own community (leaf = L2).
 *   2. For each node, greedily move it to the neighbor community that maximises
 *      modularity gain (ΔQ > 0). Repeat until no improvement.
 *   3. Aggregate communities into super-nodes and repeat (L1, L0).
 *
 * Output: hierarchy.levels where index 0 = leaf (L2), index 2 = root (L0).
 *
 * References:
 *   Blondel et al. (2008) "Fast unfolding of communities in large networks" (Louvain)
 *   Traag et al. (2019) "From Louvain to Leiden" (Leiden)
 */

export type Edge = { sourceId: string; targetId: string; weight: number }

export type CommunityLevel = {
  /** Map from nodeId to communityId at this level. */
  membership: Map<string, string>
  /** Map from communityId to set of member nodeIds. */
  communities: Map<string, Set<string>>
}

export type CommunityHierarchy = {
  /** Leaf (tightest) → root (broadest). Index 0 in array = leaf (L2). */
  levels: CommunityLevel[]
}

/** Total weight of all edges (2m in modularity formula). */
function totalWeight(edges: Edge[]): number {
  return edges.reduce((s, e) => s + e.weight, 0)
}

/** Build adjacency: nodeId → Map<neighborId, weight>. */
function buildAdj(nodes: string[], edges: Edge[]): Map<string, Map<string, number>> {
  const adj = new Map<string, Map<string, number>>()
  for (const n of nodes) adj.set(n, new Map())
  for (const e of edges) {
    if (e.sourceId === e.targetId) continue
    const src = adj.get(e.sourceId)
    const tgt = adj.get(e.targetId)
    if (src) src.set(e.targetId, (src.get(e.targetId) ?? 0) + e.weight)
    if (tgt) tgt.set(e.sourceId, (tgt.get(e.sourceId) ?? 0) + e.weight)
  }
  return adj
}

/** Sum of edge weights incident to node. */
function degree(nodeId: string, adj: Map<string, Map<string, number>>): number {
  const neighbors = adj.get(nodeId)
  if (!neighbors) return 0
  let sum = 0
  for (const w of neighbors.values()) sum += w
  return sum
}

/** Sum of weights from nodeId to any node in targetCommunity. */
function weightToComm(
  nodeId: string,
  community: Set<string>,
  adj: Map<string, Map<string, number>>,
): number {
  const neighbors = adj.get(nodeId)
  if (!neighbors) return 0
  let sum = 0
  for (const [nbr, w] of neighbors) {
    if (community.has(nbr)) sum += w
  }
  return sum
}

/**
 * One pass of Louvain phase-1: move each node to the neighbor community
 * that maximises modularity gain. Returns true if any node moved.
 */
function louvainPass(
  nodes: string[],
  adj: Map<string, Map<string, number>>,
  membership: Map<string, string>,
  communities: Map<string, Set<string>>,
  m2: number,
): boolean {
  let improved = false
  const degreeCache = new Map<string, number>()
  for (const node of nodes) {
    degreeCache.set(node, degree(node, adj))
  }

  // Sum of degrees of all nodes in each community.
  const commDegree = new Map<string, number>()
  for (const [commId, members] of communities) {
    let s = 0
    for (const n of members) s += degreeCache.get(n) ?? 0
    commDegree.set(commId, s)
  }

  for (const node of nodes) {
    const currentComm = membership.get(node)!
    const ki = degreeCache.get(node) ?? 0

    // Remove node from its current community.
    const currentSet = communities.get(currentComm)!
    currentSet.delete(node)
    const kiIn = weightToComm(node, currentSet, adj)
    const sumTotCurrent = (commDegree.get(currentComm) ?? 0) - ki

    // Candidate communities: current + all neighbor communities.
    const candidates = new Set<string>([currentComm])
    const neighbors = adj.get(node)
    if (neighbors) {
      for (const nbr of neighbors.keys()) {
        const c = membership.get(nbr)
        if (c) candidates.add(c)
      }
    }

    let bestGain = 0
    let bestComm = currentComm

    for (const candidateComm of candidates) {
      if (candidateComm === currentComm) continue
      const candidateSet = communities.get(candidateComm)!
      const kiInCandidate = weightToComm(node, candidateSet, adj)
      const sumTotCandidate = commDegree.get(candidateComm) ?? 0

      // ΔQ = [k_i,in/m - k_i * Σtot / (2m²)] for moving into candidate
      // minus the same for staying in current (empty after removal).
      const gain =
        (kiInCandidate - kiIn) / (m2 / 2) - (ki * (sumTotCandidate - sumTotCurrent)) / (m2 * m2)

      if (gain > bestGain) {
        bestGain = gain
        bestComm = candidateComm
      }
    }

    // Move node to best community.
    membership.set(node, bestComm)
    communities.get(bestComm)!.add(node)
    commDegree.set(bestComm, (commDegree.get(bestComm) ?? 0) + ki)

    if (bestComm !== currentComm) {
      improved = true
      commDegree.set(currentComm, Math.max(0, (commDegree.get(currentComm) ?? 0) - ki))
    } else {
      // Re-add to original (it stayed)
    }
  }

  // Clean up empty communities.
  for (const [id, members] of communities) {
    if (members.size === 0) communities.delete(id)
  }

  return improved
}

/**
 * Run Louvain phases until convergence, then build super-graph for next level.
 */
function louvainLevel(
  nodes: string[],
  edges: Edge[],
): { membership: Map<string, string>; communities: Map<string, Set<string>> } {
  // Initialise: each node in its own community.
  const membership = new Map<string, string>()
  const communities = new Map<string, Set<string>>()
  for (const n of nodes) {
    membership.set(n, n)
    communities.set(n, new Set([n]))
  }

  const adj = buildAdj(nodes, edges)
  const m2 = totalWeight(edges) * 2
  if (m2 === 0) return { membership, communities }

  // Phase 1: iterate until stable.
  let maxIterations = 20
  while (maxIterations-- > 0) {
    const moved = louvainPass(nodes, adj, membership, communities, m2)
    if (!moved) break
  }

  return { membership, communities }
}

/**
 * Build the next-level super-graph by collapsing communities into super-nodes.
 */
function buildSuperGraph(
  communities: Map<string, Set<string>>,
  edges: Edge[],
  membership: Map<string, string>,
): { superNodes: string[]; superEdges: Edge[] } {
  const superNodes = [...communities.keys()]
  const edgeWeights = new Map<string, number>()

  for (const e of edges) {
    const sc = membership.get(e.sourceId)
    const tc = membership.get(e.targetId)
    if (!sc || !tc || sc === tc) continue
    const key = sc < tc ? `${sc}::${tc}` : `${tc}::${sc}`
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + e.weight)
  }

  const superEdges: Edge[] = []
  for (const [key, weight] of edgeWeights) {
    const [a, b] = key.split('::')
    superEdges.push({ sourceId: a, targetId: b, weight })
  }

  return { superNodes, superEdges }
}

/**
 * Detect hierarchical communities using a 3-level Louvain algorithm.
 *
 * Returns levels where index 0 = leaf (L2, most granular)
 * and index 2 = root (L0, most abstract).
 *
 * If nodes.length < 2 or there are no edges, returns a trivial hierarchy
 * where every node is its own community at all levels.
 */
export function detectCommunities(nodes: string[], edges: Edge[], levels = 3): CommunityHierarchy {
  if (nodes.length < 2) {
    // Trivial: each node is its own community at all levels.
    const trivial: CommunityLevel = {
      membership: new Map(nodes.map((n) => [n, n])),
      communities: new Map(nodes.map((n) => [n, new Set([n])])),
    }
    return { levels: Array.from({ length: levels }, () => ({ ...trivial })) }
  }

  const hierarchy: CommunityLevel[] = []

  // Leaf → root: run Louvain on increasingly coarse graphs.
  let currentNodes = nodes
  let currentEdges = edges

  // Track super-node ancestry: superNodeId → original node ids.
  let superNodeToOriginals = new Map<string, Set<string>>()
  for (const n of nodes) superNodeToOriginals.set(n, new Set([n]))

  for (let level = 0; level < levels; level++) {
    const { membership: levelMembership, communities: levelCommunities } = louvainLevel(
      currentNodes,
      currentEdges,
    )

    if (level === 0) {
      // Leaf: direct node → community mapping.
      hierarchy.push({
        membership: new Map(levelMembership),
        communities: new Map(
          [...levelCommunities].map(([cId, members]) => [cId, new Set(members)]),
        ),
      })
    } else {
      // Higher levels: map back to original node ids.
      const originalMembership = new Map<string, string>()
      const originalCommunities = new Map<string, Set<string>>()

      for (const [superNode, commId] of levelMembership) {
        const originals = superNodeToOriginals.get(superNode) ?? new Set([superNode])
        for (const orig of originals) {
          originalMembership.set(orig, commId)
          if (!originalCommunities.has(commId)) originalCommunities.set(commId, new Set())
          originalCommunities.get(commId)!.add(orig)
        }
      }

      hierarchy.push({ membership: originalMembership, communities: originalCommunities })
    }

    if (level < levels - 1) {
      // Build super-graph for next level.
      const { superNodes, superEdges } = buildSuperGraph(
        levelCommunities,
        currentEdges,
        levelMembership,
      )

      // Update ancestry map.
      const nextAncestry = new Map<string, Set<string>>()
      for (const [commId, members] of levelCommunities) {
        const originals = new Set<string>()
        for (const m of members) {
          const prevOriginals = superNodeToOriginals.get(m) ?? new Set([m])
          for (const o of prevOriginals) originals.add(o)
        }
        nextAncestry.set(commId, originals)
      }
      superNodeToOriginals = nextAncestry

      currentNodes = superNodes
      currentEdges = superEdges

      // Stop early if all nodes collapsed into one community.
      if (currentNodes.length <= 1) {
        // Fill remaining levels with the same partition.
        while (hierarchy.length < levels) {
          hierarchy.push(hierarchy[hierarchy.length - 1])
        }
        break
      }
    }
  }

  return { levels: hierarchy }
}
