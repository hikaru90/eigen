import { describe, expect, it } from 'vitest';
import {
	embeddingMapLabelText,
	embeddingMapShouldSuppressSelectionClick,
	embeddingMapWheelMode,
	embeddingMapWheelPanDeltas,
	screenSpacePointScale
} from './embedding-map-3d';
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

describe('screenSpacePointScale', () => {
	it('is unity at the reference camera distance', () => {
		expect(screenSpacePointScale(2.4, 2.4)).toBe(1);
	});

	it('shrinks world radius when the camera moves closer', () => {
		expect(screenSpacePointScale(1.2, 2.4)).toBe(0.5);
	});

	it('grows world radius when the camera moves farther', () => {
		expect(screenSpacePointScale(4.8, 2.4)).toBe(2);
	});
});

describe('embeddingMapWheelMode', () => {
	it('zooms on pinch-style ctrl/meta wheel', () => {
		expect(
			embeddingMapWheelMode({
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
				deltaX: 0,
				deltaY: -12,
				deltaMode: 0
			})
		).toBe('zoom');
	});

	it('pans on shift wheel', () => {
		expect(
			embeddingMapWheelMode({
				ctrlKey: false,
				metaKey: false,
				shiftKey: true,
				deltaX: 0,
				deltaY: 8,
				deltaMode: 1
			})
		).toBe('pan');
	});

	it('pans on trackpad pixel wheel', () => {
		expect(
			embeddingMapWheelMode({
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
				deltaX: 3,
				deltaY: -2,
				deltaMode: 0
			})
		).toBe('pan');
	});

	it('zooms on mouse line wheel', () => {
		expect(
			embeddingMapWheelMode({
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
				deltaX: 0,
				deltaY: 120,
				deltaMode: 1
			})
		).toBe('zoom');
	});
});

describe('embeddingMapWheelPanDeltas', () => {
	it('inverts wheel deltas for natural trackpad pan direction', () => {
		expect(embeddingMapWheelPanDeltas(12, -8)).toEqual({ x: -12, y: 8 });
	});
});

describe('embeddingMapShouldSuppressSelectionClick', () => {
	it('suppresses click after drag or with shift held', () => {
		expect(embeddingMapShouldSuppressSelectionClick({ dragged: true, shiftKey: false })).toBe(true);
		expect(embeddingMapShouldSuppressSelectionClick({ dragged: false, shiftKey: true })).toBe(true);
		expect(embeddingMapShouldSuppressSelectionClick({ dragged: false, shiftKey: false })).toBe(false);
	});
});

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
