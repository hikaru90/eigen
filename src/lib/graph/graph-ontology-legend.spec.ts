import { describe, expect, it } from 'vitest';
import { mergeGraphLegendWithUserOntology } from './graph-ontology-legend';

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
