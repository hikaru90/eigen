import { describe, expect, it } from 'vitest';
import {
	filterEdgesByAuthorLayers,
	filterNodesByAuthorLayers,
	isEmbeddingItemVisibleByAuthorLayers
} from './graph-author-layers';

describe('graph-author-layers filters', () => {
	const nodes = [
		{ id: 'e1', authorLayerKeys: ['user'] },
		{ id: 'e2', authorLayerKeys: ['apikey:key-1'] },
		{ id: 'e3', authorLayerKeys: ['user', 'apikey:key-1'] }
	];

	it('shows all nodes when no author layers selected', () => {
		expect(filterNodesByAuthorLayers(nodes, new Set())).toHaveLength(3);
	});

	it('filters nodes by selected author layers', () => {
		const filtered = filterNodesByAuthorLayers(nodes, new Set(['apikey:key-1']));
		expect(filtered.map((n) => n.id)).toEqual(['e2', 'e3']);
	});

	it('filters thought embedding items by authorLayerKey', () => {
		expect(
			isEmbeddingItemVisibleByAuthorLayers(
				{ kind: 'Thought', authorLayerKey: 'apikey:key-1' },
				new Set(['user'])
			)
		).toBe(false);
		expect(
			isEmbeddingItemVisibleByAuthorLayers(
				{ kind: 'Thought', authorLayerKey: 'apikey:key-1' },
				new Set(['apikey:key-1'])
			)
		).toBe(true);
	});

	it('filters co-mention edges by layer index', () => {
		const edges = [
			{ sourceId: 'a', targetId: 'b', kind: 'co_mention' },
			{ sourceId: 'c', targetId: 'd', kind: 'entity_relation' }
		];
		const coMentionKeys = { 'a:b': ['user'], 'c:d': ['apikey:key-1'] };
		const visibleNodeIds = new Set(['a', 'b', 'c', 'd']);
		const filtered = filterEdgesByAuthorLayers(
			edges,
			new Set(['user']),
			coMentionKeys,
			visibleNodeIds
		);
		expect(filtered.map((e) => e.kind)).toEqual(['co_mention', 'entity_relation']);
	});
});
