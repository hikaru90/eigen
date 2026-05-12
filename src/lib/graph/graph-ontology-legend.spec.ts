import { describe, expect, it } from 'vitest';
import { graphOntologyLegendSections, mergeGraphLegendWithUserOntology } from './graph-ontology-legend';

describe('mergeGraphLegendWithUserOntology', () => {
	it('prepends user ontology sections before static graph legend', () => {
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
		expect(merged[2]).toEqual(graphOntologyLegendSections[0]);
		expect(merged.length).toBe(2 + graphOntologyLegendSections.length);
	});

	it('omits empty ontology sections', () => {
		const merged = mergeGraphLegendWithUserOntology({
			entityKinds: [],
			relationKinds: []
		});
		expect(merged).toEqual(graphOntologyLegendSections);
	});
});
