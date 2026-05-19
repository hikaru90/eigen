import {
	fetchGraphVisualizationSnapshot,
	type GraphVizEdge,
	type GraphVizNode
} from '$lib/server/graph/falkor';

export type EvalGraphSnapshot = {
	nodes: GraphVizNode[];
	edges: GraphVizEdge[];
	capturedAt: string;
};

const EVAL_NODE_LIMIT = 300;
const EVAL_EDGE_LIMIT = 600;

/** Relabel Thought nodes with eval fixture ids when known. */
export function labelEvalGraphNodes(
	nodes: GraphVizNode[],
	uuidToFixture: Map<string, string>
): GraphVizNode[] {
	return nodes.map((node) => {
		if (node.kind !== 'Thought') return node;
		const fixtureId = uuidToFixture.get(node.id);
		if (!fixtureId) return node;
		const base = node.label.trim() || fixtureId;
		return {
			...node,
			label: base.startsWith(`${fixtureId} ·`) ? base : `${fixtureId} · ${base}`
		};
	});
}

export async function captureEvalGraphSnapshot(input: {
	evalUserId: string;
	fixtureToUuid: Map<string, string>;
	nodeLimit?: number;
	edgeLimit?: number;
}): Promise<EvalGraphSnapshot> {
	const uuidToFixture = new Map<string, string>();
	for (const [fixtureId, uuid] of input.fixtureToUuid) {
		uuidToFixture.set(uuid, fixtureId);
	}

	const raw = await fetchGraphVisualizationSnapshot({
		userId: input.evalUserId,
		nodeLimit: input.nodeLimit ?? EVAL_NODE_LIMIT,
		edgeLimit: input.edgeLimit ?? EVAL_EDGE_LIMIT
	});

	return {
		nodes: labelEvalGraphNodes(raw.nodes, uuidToFixture),
		edges: raw.edges,
		capturedAt: new Date().toISOString()
	};
}
