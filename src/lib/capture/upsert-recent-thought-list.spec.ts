import { describe, expect, it } from 'vitest';
import { upsertRecentThoughtList } from './upsert-recent-thought-list';
import type { CaptureSubmitResult } from '$lib/capture/capture-result-types';

function thought(id: string, category = 'observation'): CaptureSubmitResult {
	return {
		id,
		normalizedText: `text-${id}`,
		category,
		metadata: {},
		memoryType: null,
		cues: [],
		enrichedAt: null,
		entities: [],
		temporalEvents: [],
		linkedThoughts: [],
		attachedFiles: [],
		enrichmentComplete: false,
		queueStatus: 'pending'
	};
}

describe('upsertRecentThoughtList', () => {
	const existing = [
		{ id: 'a', normalizedText: 'A', category: 'observation', memoryType: null, createdAt: '2026-01-01T00:00:00.000Z' },
		{ id: 'b', normalizedText: 'B', category: 'observation', memoryType: null, createdAt: '2026-01-02T00:00:00.000Z' }
	];

	it('prepends new thoughts when pinToTop is true', () => {
		const next = upsertRecentThoughtList(existing, thought('c'), { pinToTop: true, limit: 8 });
		expect(next.map((row) => row.id)).toEqual(['c', 'a', 'b']);
	});

	it('updates in place without reordering when thought already exists', () => {
		const next = upsertRecentThoughtList(existing, thought('b', 'fact'), { limit: 8 });
		expect(next.map((row) => row.id)).toEqual(['a', 'b']);
		expect(next[1]?.category).toBe('fact');
		expect(next[1]?.createdAt).toBe('2026-01-02T00:00:00.000Z');
	});

	it('prepends by default for unseen thoughts', () => {
		const next = upsertRecentThoughtList(existing, thought('c'), { limit: 8 });
		expect(next.map((row) => row.id)).toEqual(['c', 'a', 'b']);
	});
});
