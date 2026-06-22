import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollCaptureRecentSync } from './poll-capture-recent-sync';

describe('pollCaptureRecentSync', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('syncs newly discovered thoughts from the server', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				recentThoughts: [
					{
						id: 't1',
						normalizedText: 'Recipe',
						category: 'observation',
						memoryType: null,
						createdAt: '2026-06-06T18:00:00.000Z'
					}
				],
				recentThoughtDetails: [
					{
						id: 't1',
						normalizedText: 'Recipe',
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
						queueStatus: 'processing'
					}
				]
			})
		});
		vi.stubGlobal('fetch', fetchMock);

		const syncs: string[][] = [];
		const cancel = pollCaptureRecentSync({
			limit: 8,
			getState: () => ({ snippets: [], details: {} }),
			pollMs: 100,
			onSync: ({ newThoughtIds }) => {
				syncs.push(newThoughtIds);
			}
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledWith('/api/capture/recent', { cache: 'no-store' });
		expect(syncs).toEqual([['t1']]);
		cancel();
	});

	it('syncs when MCP deletes thoughts from the server list', async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					recentThoughts: [
						{
							id: 'gone',
							normalizedText: 'gone',
							category: 'observation',
							memoryType: 'fact',
							createdAt: '2026-06-06T18:00:00.000Z'
						}
					],
					recentThoughtDetails: [
						{
							id: 'gone',
							normalizedText: 'gone',
							category: 'observation',
							metadata: {},
							memoryType: 'fact',
							cues: [],
							enrichedAt: '2026-06-06T18:00:00.000Z',
							entities: [],
							temporalEvents: [],
							linkedThoughts: [],
						attachedFiles: [],
							enrichmentComplete: true,
							queueStatus: 'complete'
						}
					]
				})
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					recentThoughts: [],
					recentThoughtDetails: []
				})
			});
		vi.stubGlobal('fetch', fetchMock);

		const syncSnippetIds: string[][] = [];
		const cancel = pollCaptureRecentSync({
			limit: 8,
			getState: () => ({
				snippets: [
					{
						id: 'gone',
						normalizedText: 'gone',
						category: 'observation',
						memoryType: 'fact',
						createdAt: '2026-06-06T18:00:00.000Z'
					}
				],
				details: {
					gone: {
						id: 'gone',
						normalizedText: 'gone',
						category: 'observation',
						metadata: {},
						memoryType: 'fact',
						cues: [],
						enrichedAt: '2026-06-06T18:00:00.000Z',
						entities: [],
						temporalEvents: [],
						linkedThoughts: [],
						attachedFiles: [],
						enrichmentComplete: true,
						queueStatus: 'complete'
					}
				}
			}),
			pollMs: 100,
			onSync: ({ snippets }) => {
				syncSnippetIds.push(snippets.map((row) => row.id));
			}
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(syncSnippetIds).toEqual([]);

		await vi.advanceTimersByTimeAsync(100);
		expect(syncSnippetIds).toEqual([[]]);
		cancel();
	});
});
