/**
 * Graph legend: node colors + relation vocabulary for `/graph`.
 *
 * - **Thought** nodes = rows you capture (Postgres + graph). `subtype` is the capture **category**
 *   (thought / task / idea / reference / date / person) for coloring.
 * - **Entity** nodes = noun-like subjects **extracted** from thought text (LLM mentions + resolution).
 *   `subtype` is entity type (person, org, place, topic, product, other).
 * - **Edges** = `kind` is the graph connector (thought_link, mention, entity_relation). `relationType`
 *   is the semantic label (thought↔thought vs entity↔entity vocabularies differ).
 *
 * Capture categories align with `LEGACY_CAPTURE_CATEGORY_KEYS` in the DB schema; entity extraction
 * allowlist, `relation-extraction.ts`, and `GraphVizEdgeKind` in falkor stay the source for graph edges.
 * Per-user cognitive ontology sections are merged via `mergeGraphLegendWithUserOntology` (server data).
 */

const THOUGHT_FILLS: Record<string, string> = {
	thought: '#64748b',
	task: '#0ea5e9',
	idea: '#f59e0b',
	reference: '#22c55e',
	date: '#f43f5e',
	person: '#a78bfa'
};

const ENTITY_FILLS: Record<string, string> = {
	person: '#c026d3',
	org: '#9333ea',
	place: '#7c3aed',
	topic: '#6d28d9',
	product: '#5b21b6',
	other: '#a855f7'
};

/** Short copy for the graph legend header. */
export const graphOntologyLegendIntro =
	'Thoughts are captures you wrote. Entities are subjects extracted from them into shared nodes. Edge kind is the connector shape; chips below are semantic types.';

export function thoughtNodeFill(subtype: string): string {
	const k = subtype.trim().toLowerCase();
	return THOUGHT_FILLS[k] ?? THOUGHT_FILLS.thought;
}

export function entityNodeFill(subtype: string): string {
	const k = subtype.trim().toLowerCase();
	return ENTITY_FILLS[k] ?? ENTITY_FILLS.other;
}

/** `kind` is graph snapshot kind: `Thought` | `Entity`. */
export function nodeFillForGraph(kind: string, subtype: string): string {
	if (kind === 'Entity') return entityNodeFill(subtype);
	return thoughtNodeFill(subtype);
}

export type GraphLegendItem = {
	key: string;
	label: string;
	hint: string;
	/** When set, legend shows a color dot (node ontology). Omit for relation vocabulary chips. */
	fill?: string;
};

export type GraphLegendSection = {
	title: string;
	items: GraphLegendItem[];
};

const THOUGHT_LEGEND_ITEMS: GraphLegendItem[] = [
	{ key: 'thought', label: 'Thought', hint: 'General notes & context', fill: THOUGHT_FILLS.thought },
	{ key: 'task', label: 'Task', hint: 'Todos & follow-ups', fill: THOUGHT_FILLS.task },
	{ key: 'idea', label: 'Idea', hint: 'Concepts & brainstorms', fill: THOUGHT_FILLS.idea },
	{ key: 'reference', label: 'Reference', hint: 'Links & external pointers', fill: THOUGHT_FILLS.reference },
	{ key: 'date', label: 'Date', hint: 'Schedule & time anchors', fill: THOUGHT_FILLS.date },
	{ key: 'person', label: 'Person', hint: 'Capture about a specific human', fill: THOUGHT_FILLS.person }
];

const ENTITY_LEGEND_ITEMS: GraphLegendItem[] = [
	{ key: 'person', label: 'Person', hint: 'Named people', fill: ENTITY_FILLS.person },
	{ key: 'org', label: 'Org', hint: 'Companies & teams', fill: ENTITY_FILLS.org },
	{ key: 'place', label: 'Place', hint: 'Locations', fill: ENTITY_FILLS.place },
	{ key: 'topic', label: 'Topic', hint: 'Subjects & themes', fill: ENTITY_FILLS.topic },
	{ key: 'product', label: 'Product', hint: 'Tools & offerings', fill: ENTITY_FILLS.product },
	{ key: 'other', label: 'Other', hint: 'Misc entities', fill: ENTITY_FILLS.other }
];

/** Thought → thought (`RELATES_TO`); labels from relation extraction. */
const THOUGHT_LINK_LABELS: GraphLegendItem[] = [
	{ key: 'mentions', label: 'mentions', hint: 'Source points at or names the target thought' },
	{ key: 'depends_on', label: 'depends_on', hint: 'Source relies on target' },
	{ key: 'refines', label: 'refines', hint: 'Source narrows or improves target' },
	{ key: 'contradicts', label: 'contradicts', hint: 'Source conflicts with target' },
	{ key: 'related_to', label: 'related_to', hint: 'General association' }
];

/** Entity → entity (`ENTITY_RELATES`); predicates from entity extraction. */
const ENTITY_LINK_LABELS: GraphLegendItem[] = [
	{ key: 'er-related_to', label: 'related_to', hint: 'Loose association' },
	{ key: 'er-depends_on', label: 'depends_on', hint: 'Dependency' },
	{ key: 'part_of', label: 'part_of', hint: 'Containment / membership' },
	{ key: 'located_in', label: 'located_in', hint: 'Spatial containment' },
	{ key: 'knows', label: 'knows', hint: 'Social link' },
	{ key: 'works_at', label: 'works_at', hint: 'Employment / affiliation' }
];

/** Graph edge kinds (how the line is drawn in the snapshot). */
const EDGE_KIND_LABELS: GraphLegendItem[] = [
	{
		key: 'thought_link',
		label: 'thought_link',
		hint: 'Thought → thought (RELATES_TO)'
	},
	{
		key: 'mention',
		label: 'mention',
		hint: 'Thought → entity (MENTIONS)'
	},
	{
		key: 'entity_relation',
		label: 'entity_relation',
		hint: 'Entity → entity (ENTITY_RELATES)'
	}
];

/** Sections: nodes first, then relation vocabulary (static graph snapshot vocabulary). */
export const graphOntologyLegendSections: GraphLegendSection[] = [
	{ title: 'Capture categories (thought nodes)', items: THOUGHT_LEGEND_ITEMS },
	{ title: 'Entity types (entity nodes)', items: ENTITY_LEGEND_ITEMS },
	{ title: 'Thought → thought labels', items: THOUGHT_LINK_LABELS },
	{ title: 'Entity → entity predicates', items: ENTITY_LINK_LABELS },
	{ title: 'Edge kinds', items: EDGE_KIND_LABELS }
];

/** Deterministic fill for a user ontology entity kind key (no TS closed union). */
export function ontologyFillForKey(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) {
		h = (h * 31 + key.charCodeAt(i)) >>> 0;
	}
	const hue = h % 360;
	return `hsl(${hue} 52% 42%)`;
}

export type UserOntologyLegendInput = {
	entityKinds: { key: string; name: string; definition: string; active: boolean }[];
	relationKinds: {
		key: string;
		meaning: string;
		active: boolean;
		fromKindKey: string;
		toKindKey: string;
	}[];
};

/** Prepends persisted user ontology sections ahead of the static graph legend. */
export function mergeGraphLegendWithUserOntology(ontology: UserOntologyLegendInput): GraphLegendSection[] {
	const entityByKey = new Map(ontology.entityKinds.map((e) => [e.key, e]));
	const cognitiveEntities: GraphLegendItem[] = ontology.entityKinds
		.filter((e) => e.active)
		.map((e) => ({
			key: `onto-entity-${e.key}`,
			label: e.name,
			hint: e.definition,
			fill: ontologyFillForKey(e.key)
		}));

	const cognitiveRelations: GraphLegendItem[] = ontology.relationKinds
		.filter((r) => r.active)
		.map((r) => {
			const from = entityByKey.get(r.fromKindKey)?.name ?? r.fromKindKey;
			const to = entityByKey.get(r.toKindKey)?.name ?? r.toKindKey;
			return {
				key: `onto-rel-${r.key}`,
				label: r.key,
				hint: `${from} → ${to}. ${r.meaning}`
			};
		});

	const prefix: GraphLegendSection[] = [];
	if (cognitiveEntities.length > 0) {
		prefix.push({ title: 'Your ontology: entity kinds', items: cognitiveEntities });
	}
	if (cognitiveRelations.length > 0) {
		prefix.push({ title: 'Your ontology: relation kinds', items: cognitiveRelations });
	}
	return [...prefix, ...graphOntologyLegendSections];
}
