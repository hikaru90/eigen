export const GRAPH_REARRANGE_PHASE_COPY = {
  prune_weak_edges: {
    title: 'Pruning weak edges',
    description: 'Removing low-confidence entity edges that should not stay in your graph.',
  },
  prune_orphan_thoughts: {
    title: 'Removing orphan thoughts',
    description: 'Deleting graph thought nodes that no longer have supporting captures.',
  },
  prune_orphan_entities: {
    title: 'Removing orphan entities',
    description: 'Deleting entity nodes that no longer link to any stored thought.',
  },
  prune_duplicate_edges: {
    title: 'Removing duplicate edges',
    description: 'Collapsing duplicate thought-relation edges driven by repeated captures.',
  },
  check_connections: {
    title: 'Checking relation logic',
    description: 'Removing illogical entity relation edges that violate your ontology.',
  },
  repair_relations: {
    title: 'Repairing entity relations',
    description: 'Adding missing relation edges inferred from stored entity mentions.',
  },
} as const

export type GraphRearrangePhase = keyof typeof GRAPH_REARRANGE_PHASE_COPY

export type GraphRearrangeTaskProgress = {
  processed: number
  total: number
}

export type GraphRearrangeProgressEvent = {
  phase: GraphRearrangePhase
} & Partial<GraphRearrangeTaskProgress>

export const GRAPH_REARRANGE_PIPELINE: GraphRearrangePhase[] = [
  'prune_weak_edges',
  'prune_orphan_thoughts',
  'prune_orphan_entities',
  'prune_duplicate_edges',
  'check_connections',
  'repair_relations',
]

export function graphRearrangeProgressPercent(
  phaseEvents: GraphRearrangePhase[],
  complete: boolean,
  activeTask?: GraphRearrangeTaskProgress | null,
): number {
  if (complete) return 100
  if (phaseEvents.length === 0) return 0

  // Finished pipeline steps — the latest event marks the step currently running.
  const completedCount = Math.max(0, phaseEvents.length - 1)
  let fraction = completedCount / GRAPH_REARRANGE_PIPELINE.length

  const activePhase = phaseEvents.at(-1)
  if (activePhase && activeTask && activeTask.total > 0) {
    const taskFraction = Math.min(1, activeTask.processed / activeTask.total)
    fraction += taskFraction / GRAPH_REARRANGE_PIPELINE.length
  }

  return Math.min(99, Math.round(fraction * 100))
}
