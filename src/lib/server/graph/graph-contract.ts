/** Shared graph adapter types — stable contract for capture, retrieval, and viz. */

export type GraphVizNodeKind = 'Thought' | 'Entity';

export type GraphVizNode = {
	id: string;
	kind: GraphVizNodeKind;
	label: string;
	subtype: string;
};

export type GraphVizEdgeKind = 'co_mention' | 'entity_relation';

export type GraphVizEdge = {
	id: string;
	sourceId: string;
	targetId: string;
	relationType: string;
	kind: GraphVizEdgeKind;
};

export type EntityThoughtHit = { id: string; hits: number; provenance?: string };

export type TemporalContextHit = {
	thoughtId: string;
	hits: number;
	provenance?: string;
};

export type TemporalSchedulingConflictGraphHit = {
	personEntityId: string;
	personLabel: string;
	place1EntityId: string;
	place1Label: string;
	place2EntityId: string;
	place2Label: string;
	event1Id: string;
	event2Id: string;
	event1Label: string;
	event2Label: string;
	thought1Id: string;
	thought2Id: string;
};

/** Exported graph operations (runtime adapter must implement all). */
export const GRAPH_ADAPTER_OPERATIONS = [
	'upsertThoughtNode',
	'deleteThoughtOutgoingGraphEdges',
	'deleteEntityVertexFromGraph',
	'deleteThoughtVertexFromGraph',
	'deleteAllUserGraphVertices',
	'upsertThoughtRelation',
	'expandNeighborsByIds',
	'graphOnlySearchByQuery',
	'fetchGraphVisualizationSnapshot',
	'upsertEntityNode',
	'upsertMentionEdge',
	'upsertEntityRelationEdge',
	'deleteEntityRelationEdge',
	'fetchEntityEdgesForUser',
	'expandThoughtIdsFromEntitySeeds',
	'upsertEventNode',
	'deleteEventNodeFromGraph',
	'upsertThoughtOccurrenceEdge',
	'upsertEventInvolvesEntityEdge',
	'expandContextFromTemporalEventSeeds',
	'findTemporalSchedulingConflictsInGraph',
	'thoughtExistsInGraph'
] as const;

export type GraphAdapterOperation = (typeof GRAPH_ADAPTER_OPERATIONS)[number];
