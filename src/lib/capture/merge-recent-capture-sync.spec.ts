import { describe, expect, it } from 'vitest';
import { mergeRecentCaptureFromServer } from './merge-recent-capture-sync';
import type { CaptureSubmitResult } from './capture-result-types';

function thought(id: string, overrides: Partial<CaptureSubmitResult> = {}): CaptureSubmitResult {
	return {
		id,
		normalizedText: `text-${id}`,
		category: 'observation',
		metadata: {},
		memoryType: null,
		cues: [],
		enrichedAt: null,
		entities: [],
		temporalEvents: [],
		linkedThoughts: [],
		attachedFiles: [],
		enrichmentComplete: false,
		queueStatus: 'pending',
		...overrides
	};
}

describe('mergeRecentCaptureFromServer', () => {
	it('replaces local list with server order when MCP ingests arrive', () => {
		const existing = [
			{
				id: 'old',
				normalizedText: 'old',
				category: 'observation',
				memoryType: null,
				createdAt: '2026-06-06T10:00:00.000Z'
			}
		];
		const merged = mergeRecentCaptureFromServer(
			existing,
			{ old: thought('old', { enrichmentComplete: true, queueStatus: 'complete' }) },
			{
				recentThoughts: [
					{
						id: 'a',
						normalizedText: 'a',
						category: 'observation',
						memoryType: null,
						createdAt: '2026-06-06T13:00:00.000Z'
					},
					{
						id: 'b',
						normalizedText: 'b',
						category: 'observation',
						memoryType: null,
						createdAt: '2026-06-06T12:00:00.000Z'
					}
				],
				recentThoughtDetails: [thought('a'), thought('b')]
			},
			8
		);

		expect(merged.newThoughtIds).toEqual(['a', 'b']);
		expect(merged.removedThoughtIds).toEqual(['old']);
		expect(merged.snippets.map((row) => row.id)).toEqual(['a', 'b']);
		expect(merged.details.old).toBeUndefined();
		expect(merged.details.a.queueStatus).toBe('pending');
	});

	it('keeps in-flight local captures when server recent list has not caught up yet', () => {
		const existing = [
			{
				id: 'fresh',
				normalizedText: 'Lisbon offsite',
				category: 'observation',
				memoryType: null,
				createdAt: '2026-06-06T18:00:00.000Z'
			}
		];
		const merged = mergeRecentCaptureFromServer(
			existing,
			{
				fresh: thought('fresh', { normalizedText: 'Lisbon offsite', queueStatus: 'pending' })
			},
			{ recentThoughts: [], recentThoughtDetails: [] },
			8
		);

		expect(merged.removedThoughtIds).toEqual([]);
		expect(merged.snippets.map((row) => row.id)).toEqual(['fresh']);
		expect(merged.details.fresh?.normalizedText).toBe('Lisbon offsite');
	});

	it('keeps optimistic local snippets before detail is cached', () => {
		const existing = [
			{
				id: 'fresh',
				normalizedText: 'Lisbon offsite',
				category: 'observation',
				memoryType: null,
				createdAt: '2026-06-06T18:00:00.000Z'
			}
		];
		const merged = mergeRecentCaptureFromServer(
			existing,
			{},
			{ recentThoughts: [], recentThoughtDetails: [] },
			8
		);

		expect(merged.removedThoughtIds).toEqual([]);
		expect(merged.snippets.map((row) => row.id)).toEqual(['fresh']);
	});

	it('removes locally cached thoughts deleted via MCP or another tab', () => {
		const existing = [
			{
				id: 'gone',
				normalizedText: 'gone',
				category: 'observation',
				memoryType: 'fact',
				createdAt: '2026-06-06T10:00:00.000Z'
			},
			{
				id: 'stay',
				normalizedText: 'stay',
				category: 'observation',
				memoryType: 'fact',
				createdAt: '2026-06-06T09:00:00.000Z'
			}
		];
		const merged = mergeRecentCaptureFromServer(
			existing,
			{
				gone: thought('gone', { enrichmentComplete: true, queueStatus: 'complete' }),
				stay: thought('stay', { enrichmentComplete: true, queueStatus: 'complete' })
			},
			{
				recentThoughts: [
					{
						id: 'stay',
						normalizedText: 'stay',
						category: 'observation',
						memoryType: 'fact',
						createdAt: '2026-06-06T09:00:00.000Z'
					}
				],
				recentThoughtDetails: [
					thought('stay', {
						memoryType: 'fact',
						enrichmentComplete: true,
						queueStatus: 'complete'
					})
				]
			},
			8
		);

		expect(merged.newThoughtIds).toEqual([]);
		expect(merged.removedThoughtIds).toEqual(['gone']);
		expect(merged.snippets.map((row) => row.id)).toEqual(['stay']);
		expect(merged.details.gone).toBeUndefined();
	});

	it('refreshes existing snippets when enrich fields update', () => {
		const existing = [
			{
				id: 't1',
				normalizedText: 'Recipe',
				category: 'observation',
				memoryType: null,
				createdAt: '2026-06-06T10:00:00.000Z'
			}
		];
		const merged = mergeRecentCaptureFromServer(
			existing,
			{ t1: thought('t1') },
			{
				recentThoughts: [
					{
						id: 't1',
						normalizedText: 'Recipe',
						category: 'observation',
						memoryType: 'fact',
						createdAt: '2026-06-06T10:00:00.000Z'
					}
				],
				recentThoughtDetails: [
					thought('t1', {
						memoryType: 'fact',
						enrichmentComplete: true,
						queueStatus: 'complete'
					})
				]
			},
			8
		);

		expect(merged.newThoughtIds).toEqual([]);
		expect(merged.removedThoughtIds).toEqual([]);
		expect(merged.snippets[0]?.memoryType).toBe('fact');
		expect(merged.details.t1.enrichmentComplete).toBe(true);
	});
});
