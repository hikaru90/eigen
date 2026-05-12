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

	const sections: GraphLegendSection[] = [];
	if (cognitiveEntities.length > 0) {
		sections.push({ title: 'Your ontology: entity kinds', items: cognitiveEntities });
	}
	if (cognitiveRelations.length > 0) {
		sections.push({ title: 'Your ontology: relation kinds', items: cognitiveRelations });
	}
	return sections;
}
