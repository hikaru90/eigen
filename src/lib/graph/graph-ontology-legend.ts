/**
 * Graph legend: node colors + relation vocabulary for `/graph`.
 *
 * - **Thought** nodes = rows you capture. `subtype` is the ontology **entity kind key** (same as
 *   `ontology_entity_kind.key`), colored from the "Your ontology: entity kinds" legend chips.
 * - **Entity** nodes = noun-like subjects **extracted** from thought text (LLM mentions + resolution).
 *   `subtype` is the **same** ontology entity kind key chosen for that mention (single catalog as thoughts).
 * - **Edges** = `kind` is the graph connector (thought_link, mention, entity_relation). `relationType`
 *   is the semantic label (thought↔thought vs entity↔entity vocabularies differ).
 *
 * Per-user cognitive ontology sections are merged via `mergeGraphLegendWithUserOntology` (server data).
 */

/** Short copy for the graph legend header. */
export const graphOntologyLegendIntro =
	'Graph nodes use the same ontology kind keys for typing and colors. Edge kind is the connector shape; chips below are semantic types.';

/** Deterministic fill for a user ontology entity kind key (no TS closed union). */
export function ontologyFillForKey(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) {
		h = (h * 31 + key.charCodeAt(i)) >>> 0;
	}
	const hue = h % 360;
	return `hsl(${hue} 52% 42%)`;
}

/** `kind` is graph snapshot kind: `Thought` | `Entity`. Both use ontology entity kind keys for `subtype`. */
export function nodeFillForGraph(
	kind: string,
	subtype: string,
	customEntityFills?: Map<string, string>
): string {
	void kind;
	if (customEntityFills?.has(subtype)) return customEntityFills.get(subtype)!;
	return ontologyFillForKey(subtype);
}

/**
 * Build a map from ontology entity kind key → fill color from the legend sections
 * returned by `mergeGraphLegendWithUserOntology`, so graph nodes get the same
 * color as their legend chip.
 */
export function customEntityFillsFromLegendSections(
	sections: { title: string; items: { key: string; fill?: string }[] }[]
): Map<string, string> {
	const map = new Map<string, string>();
	for (const section of sections) {
		if (section.title !== 'Your ontology: entity kinds') continue;
		for (const item of section.items) {
			const key = item.key.replace(/^onto-entity-/, '');
			if (item.fill) map.set(key, item.fill);
		}
	}
	return map;
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
