import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runGraphRearrangeMock } = vi.hoisted(() => ({
	runGraphRearrangeMock: vi.fn()
}));

vi.mock('$lib/server/graph/run-graph-rearrange', () => ({
	runGraphRearrangeForUser: runGraphRearrangeMock
}));

import { POST } from './+server';

describe('POST /api/graph/rearrange', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runGraphRearrangeMock.mockResolvedValue({
			pruned: { scanned: 1, removed: 0 },
			orphanThoughts: { graphThoughts: 0, orphanThoughts: 0, removed: 0 },
			orphanEntities: { graphEntities: 0, orphanEntities: 0, removed: 0 },
			duplicatePruned: { scanned: 1, flagged: 0, removed: 0 },
			connections: { scanned: 1, flagged: 0, removed: 0 },
			repaired: {
				scanned: 0,
				gaps: 0,
				processed: 0,
				repaired: 0,
				edgesAdded: 0,
				suspiciousEdgesRemoved: 0
			}
		});
	});

	it('requires auth', async () => {
		await expect(POST({ locals: { user: null } } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('runs rearrange for any signed-in user', async () => {
		const res = await POST({
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			request: { headers: { get: () => '' }, signal: { addEventListener: () => {} } }
		} as never);
		expect(res.status).toBe(200);
		expect(runGraphRearrangeMock).toHaveBeenCalledWith('u1');
	});

	it('streams ndjson when Accept includes application/x-ndjson', async () => {
		const phases: string[] = [];
		runGraphRearrangeMock.mockImplementation(async (_userId: string, onProgress?: (phase: string) => void) => {
			await onProgress?.('prune_weak_edges');
			await onProgress?.('repair_relations');
			return {
				pruned: { scanned: 1, removed: 0 },
				orphanThoughts: { graphThoughts: 0, orphanThoughts: 0, removed: 0 },
				orphanEntities: { graphEntities: 0, orphanEntities: 0, removed: 0 },
				duplicatePruned: { scanned: 1, flagged: 0, removed: 0 },
				connections: { scanned: 1, flagged: 0, removed: 0 },
				repaired: {
					scanned: 0,
					gaps: 0,
					processed: 0,
					repaired: 0,
					edgesAdded: 0,
					suspiciousEdgesRemoved: 0
				}
			};
		});

		const res = await POST({
			locals: { user: { id: 'u1', email: 'a@b.com' } },
			request: {
				headers: {
					get: (name: string) => (name.toLowerCase() === 'accept' ? 'application/x-ndjson' : null)
				},
				signal: { addEventListener: () => {} }
			}
		} as never);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/x-ndjson');
		const text = await res.text();
		const lines = text
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { type: string; phase?: string });
		for (const line of lines) {
			if (line.type === 'progress' && line.phase) phases.push(line.phase);
		}
		expect(phases).toEqual(['prune_weak_edges', 'repair_relations']);
		expect(lines.at(-1)).toMatchObject({ type: 'done' });
	});
});
