import { describe, expect, it } from 'vitest';
import {
	entityKindKeyFromLegendItem,
	filterNodesByEntityTypes,
	mergeGraphLegendWithUserOntology
} from './graph-ontology-legend';

describe('mergeGraphLegendWithUserOntology', () => {
	it('includes only active entity kinds and relations', () => {
		const merged = mergeGraphLegendWithUserOntology({
			entityKinds: [
				{ key: 'k1', name: 'Kind One', definition: 'd1', active: true },
				{ key: 'off', name: 'Off', definition: '', active: false }
			],
			relationKinds: [
				{
					key: 'rel',
					meaning: 'm',
					active: true,
					fromKindKey: 'k1',
					toKindKey: 'k1'
				}
			]
		});
		expect(merged[0]?.title).toBe('Your ontology: entity kinds');
		expect(merged[1]?.title).toBe('Your ontology: relation kinds');
		expect(merged.length).toBe(2);
	});

	it('omits empty ontology sections and returns empty array', () => {
		const merged = mergeGraphLegendWithUserOntology({
			entityKinds: [],
			relationKinds: []
		});
		expect(merged).toEqual([]);
	});
});

describe('entityKindKeyFromLegendItem', () => {
	it('strips onto-entity- prefix', () => {
		expect(entityKindKeyFromLegendItem('onto-entity-person')).toBe('person');
	});

	it('returns key unchanged when prefix absent', () => {
		expect(entityKindKeyFromLegendItem('person')).toBe('person');
	});
});

describe('filterNodesByEntityTypes', () => {
	const nodes = [
		{ id: '1', subtype: 'person' },
		{ id: '2', subtype: 'place' },
		{ id: '3', subtype: 'other' }
	];

	it('returns all nodes when visibleTypes is empty', () => {
		expect(filterNodesByEntityTypes(nodes, new Set())).toEqual(nodes);
	});

	it('keeps only nodes matching selected types', () => {
		expect(filterNodesByEntityTypes(nodes, new Set(['person']))).toEqual([{ id: '1', subtype: 'person' }]);
	});

	it('supports multiple selected types', () => {
		expect(filterNodesByEntityTypes(nodes, new Set(['person', 'place']))).toEqual([
			{ id: '1', subtype: 'person' },
			{ id: '2', subtype: 'place' }
		]);
	});

	it('excludes orphan subtypes when filter is active', () => {
		expect(filterNodesByEntityTypes(nodes, new Set(['person']))).not.toContainEqual({
			id: '3',
			subtype: 'other'
		});
	});
});
