export const GRAPH_REARRANGE_PHASE_COPY = {
	prune_weak_edges: {
		title: 'Pruning weak edges',
		description: 'Removing low-confidence entity edges that should not stay in your graph.'
	},
	prune_orphan_thoughts: {
		title: 'Removing orphan thoughts',
		description: 'Deleting graph thought nodes that no longer have supporting captures.'
	},
	prune_orphan_entities: {
		title: 'Removing orphan entities',
		description: 'Deleting entity nodes that no longer link to any stored thought.'
	},
	prune_duplicate_edges: {
		title: 'Removing duplicate edges',
		description: 'Collapsing duplicate thought-relation edges driven by repeated captures.'
	},
	check_connections: {
		title: 'Checking relation logic',
		description: 'Removing illogical entity relation edges that violate your ontology.'
	},
	repair_relations: {
		title: 'Repairing entity relations',
		description: 'Adding missing relation edges inferred from stored entity mentions.'
	}
} as const;

export type GraphRearrangePhase = keyof typeof GRAPH_REARRANGE_PHASE_COPY;

export const GRAPH_REARRANGE_PIPELINE: GraphRearrangePhase[] = [
	'prune_weak_edges',
	'prune_orphan_thoughts',
	'prune_orphan_entities',
	'prune_duplicate_edges',
	'check_connections',
	'repair_relations'
];

export function graphRearrangeProgressPercent(
	phaseEvents: GraphRearrangePhase[],
	complete: boolean
): number {
	if (complete) return 100;
	// Only count finished steps — the latest event marks the step currently running.
	const completedCount = Math.max(0, phaseEvents.length - 1);
	return Math.round((completedCount / GRAPH_REARRANGE_PIPELINE.length) * 100);
}
