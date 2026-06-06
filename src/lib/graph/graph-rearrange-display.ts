import type { GraphRearrangeResult } from '$lib/graph/graph-edit-api';

export type GraphRearrangeSummaryLine = {
	label: string;
	count: number;
};

export function graphRearrangeSummaryLines(result: GraphRearrangeResult): GraphRearrangeSummaryLine[] {
	const lines: GraphRearrangeSummaryLine[] = [];
	const weakPruned = result.pruned?.removed ?? 0;
	const orphanThoughtsRemoved = result.orphanThoughts?.removed ?? 0;
	const orphanEntitiesRemoved = result.orphanEntities?.removed ?? 0;
	const duplicateRemoved = result.duplicatePruned?.removed ?? 0;
	const invalidRemoved = result.connections?.removed ?? 0;
	const added = result.repaired?.edgesAdded ?? 0;

	if (weakPruned > 0) {
		lines.push({ label: `weak edge${weakPruned === 1 ? '' : 's'} pruned`, count: weakPruned });
	}
	if (orphanThoughtsRemoved > 0) {
		lines.push({
			label: `orphan thought${orphanThoughtsRemoved === 1 ? '' : 's'} removed`,
			count: orphanThoughtsRemoved
		});
	}
	if (orphanEntitiesRemoved > 0) {
		lines.push({
			label: `orphan entit${orphanEntitiesRemoved === 1 ? 'y' : 'ies'} removed`,
			count: orphanEntitiesRemoved
		});
	}
	if (duplicateRemoved > 0) {
		lines.push({
			label: `duplicate-driven edge${duplicateRemoved === 1 ? '' : 's'} removed`,
			count: duplicateRemoved
		});
	}
	if (invalidRemoved > 0) {
		lines.push({
			label: `illogical relation edge${invalidRemoved === 1 ? '' : 's'} removed`,
			count: invalidRemoved
		});
	}
	if (added > 0) {
		lines.push({ label: `relation edge${added === 1 ? '' : 's'} added`, count: added });
	}

	return lines;
}

export function graphRearrangeHadChanges(result: GraphRearrangeResult): boolean {
	return graphRearrangeSummaryLines(result).length > 0;
}
