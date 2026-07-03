import { describe, expect, it } from 'vitest';
import { parseEntityTriples, resolveTripleEndpointEntityId } from './entity-extraction';

/** Picnic-linked probe texts from graph-scale eval corpus. */
const PICNIC_PROBE_TEXTS = [
	'I want to do a picnic and I need to bring fish.',
	'I need to bring bread for the picnic.',
	'I need to bring water for the picnic.',
	'I need to bring a picnic blanket.',
	'I need to bring a picnic table.',
	'I need to bring cheese for the picnic.',
	'I need to bring fruit for the picnic.',
	'I need to bring plates for the picnic.',
	'I need to bring cups for the picnic.',
	'I need to bring a corkscrew for the picnic wine.'
];

describe('picnic linked corpus extraction contract', () => {
	const graphLabels = new Set(['picnic']);
	const graphIds = new Map([['picnic', 'picnic-hub-id']]);

	it('accepts fish part_of picnic when picnic is only in graph context', () => {
		const triples = parseEntityTriples(
			'[{"subject":"fish","object":"picnic","predicate":"part_of","confidence":0.9}]',
			new Set(['fish']),
			graphLabels
		);
		expect(triples).toHaveLength(1);
		expect(triples[0]?.object).toBe('picnic');
	});

	it('resolves picnic hub id for triple wiring from graph context', () => {
		const fishId = resolveTripleEndpointEntityId(
			'fish',
			new Map([['fish', 'fish-id']]),
			graphIds
		);
		const picnicId = resolveTripleEndpointEntityId('picnic', new Map(), graphIds);
		expect(fishId).toBe('fish-id');
		expect(picnicId).toBe('picnic-hub-id');
	});

	it('most probe texts lexically reference picnic', () => {
		const withPicnic = PICNIC_PROBE_TEXTS.filter((t) => t.toLowerCase().includes('picnic'));
		expect(withPicnic.length).toBeGreaterThanOrEqual(8);
	});
});
