import { describe, expect, it } from 'vitest';
import {
	computeEmbeddingSnapshotRevision,
	type EmbeddingSnapshotMeta
} from '$lib/server/embeddings/embedding-snapshot';

describe('computeEmbeddingSnapshotRevision', () => {
	it('is stable for the same entries regardless of input order', () => {
		const entries: EmbeddingSnapshotMeta[] = [
			{ id: 'b', kind: 'Entity', updatedAt: new Date('2026-01-02T00:00:00.000Z') },
			{ id: 'a', kind: 'Thought', updatedAt: new Date('2026-01-01T00:00:00.000Z') }
		];
		const reversed = [...entries].reverse();
		expect(computeEmbeddingSnapshotRevision(entries)).toBe(
			computeEmbeddingSnapshotRevision(reversed)
		);
	});

	it('changes when an item updatedAt changes', () => {
		const base: EmbeddingSnapshotMeta[] = [
			{ id: 'a', kind: 'Thought', updatedAt: new Date('2026-01-01T00:00:00.000Z') }
		];
		const updated: EmbeddingSnapshotMeta[] = [
			{ id: 'a', kind: 'Thought', updatedAt: new Date('2026-01-02T00:00:00.000Z') }
		];
		expect(computeEmbeddingSnapshotRevision(base)).not.toBe(
			computeEmbeddingSnapshotRevision(updated)
		);
	});

	it('changes when ids differ', () => {
		const a: EmbeddingSnapshotMeta[] = [
			{ id: 'a', kind: 'Thought', updatedAt: new Date('2026-01-01T00:00:00.000Z') }
		];
		const b: EmbeddingSnapshotMeta[] = [
			{ id: 'b', kind: 'Thought', updatedAt: new Date('2026-01-01T00:00:00.000Z') }
		];
		expect(computeEmbeddingSnapshotRevision(a)).not.toBe(computeEmbeddingSnapshotRevision(b));
	});
});
