import { describe, expect, it } from 'vitest';
import { embeddingMapLabelText } from './embedding-map-3d';
import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';

function item(overrides: Partial<EmbeddingSnapshotItem> = {}): EmbeddingSnapshotItem {
	return {
		id: 'id-1',
		kind: 'Entity',
		label: 'Short label',
		subtype: 'person',
		embedding: [],
		...overrides
	};
}

describe('embeddingMapLabelText', () => {
	it('uses label when present', () => {
		expect(embeddingMapLabelText(item({ label: 'Alice' }))).toBe('Alice');
	});

	it('falls back to id when label is empty', () => {
		expect(embeddingMapLabelText(item({ label: '  ', id: 'ent-42' }))).toBe('ent-42');
	});

	it('truncates long labels like the 2D graph', () => {
		const long = 'a'.repeat(50);
		const out = embeddingMapLabelText(item({ label: long }));
		expect(out).toHaveLength(41);
		expect(out.endsWith('…')).toBe(true);
	});
});
