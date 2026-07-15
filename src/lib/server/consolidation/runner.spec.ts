import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	withDbUserMock,
	salienceComputeMock,
	pruneMock,
	repairTypesMock,
	dedupEntitiesMock,
	repairRelationsMock,
	runDetectionMock,
	runSummariesMock
} = vi.hoisted(() => ({
	withDbUserMock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => fn()),
	salienceComputeMock: vi.fn().mockResolvedValue({ decayed: 0, openTasks: 0 }),
	pruneMock: vi.fn().mockResolvedValue({ deletedEntityKindIds: [], deletedRelationKindIds: [] }),
	repairTypesMock: vi.fn().mockResolvedValue({ repaired: 0 }),
	dedupEntitiesMock: vi.fn().mockResolvedValue({ scanned: 0, candidates: 0, merged: 0 }),
	repairRelationsMock: vi.fn().mockResolvedValue({
		scanned: 0,
		gaps: 0,
		processed: 0,
		repaired: 0,
		edgesAdded: 0
	}),
	runDetectionMock: vi.fn().mockResolvedValue({ totalCommunities: 0, changed: true }),
	runSummariesMock: vi.fn().mockResolvedValue({ total: 0, summarized: 0, generated: 0, pending: 0 })
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(() => ({
		select: vi.fn(() => ({
			from: vi.fn(async () => [])
		}))
	})),
	withDbUser: withDbUserMock
}));

vi.mock('./compute-salience', () => ({ runSalienceCompute: salienceComputeMock }));
vi.mock('$lib/server/ontology-db', () => ({ pruneUnusedOntologyEntityKinds: pruneMock }));
vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
	repairCanonicalEntityTypesForUser: repairTypesMock,
	consolidateCanonicalEntityAliasesForUser: dedupEntitiesMock
}));
vi.mock('./repair-entity-relations', () => ({
	repairEntityRelationsForUser: repairRelationsMock
}));
vi.mock('./community-detection', () => ({
	runCommunityDetection: runDetectionMock
}));
vi.mock('./community-summaries', () => ({
	runCommunitySummaryGeneration: runSummariesMock,
	getCommunitySummaryStats: vi.fn().mockResolvedValue({
		total: 0,
		summarized: 0,
		pending: 0,
		deferred: 0
	}),
	formatCommunitySummaryDetail: (stats: {
		total: number;
		summarized: number;
		generated?: number;
		pending: number;
		deferred?: number;
	}) => {
		if (stats.total === 0) return 'no eligible L1 communities';
		const parts = [`${stats.summarized} of ${stats.total} L1 routing summaries`];
		if (stats.generated && stats.generated > 0) parts.push(`${stats.generated} new`);
		if (stats.pending > 0) parts.push(`${stats.pending} pending`);
		if (stats.deferred && stats.deferred > 0) parts.push(`${stats.deferred} deferred`);
		return parts.join(', ');
	}
}));

import { consolidateForUser, formatConsolidationJobErrors, formatConsolidationJobSummaries } from './runner';

describe('formatConsolidationJobSummaries', () => {
	it('includes timing and work detail for each step', () => {
		expect(
			formatConsolidationJobSummaries([
				{
					phase: 'deep_sleep',
					job: 'ontology_prune',
					ok: true,
					detail: '0 entity kinds pruned',
					durationMs: 120
				},
				{
					phase: 'rem',
					job: 'community_summaries',
					ok: true,
					detail: '12 of 45 L1 routing summaries, 3 new, 30 pending',
					durationMs: 4500
				}
			])
		).toEqual([
			'ontology prune: 0 entity kinds pruned (120ms)',
			'community summaries: 12 of 45 L1 routing summaries, 3 new, 30 pending (4.5s)'
		]);
	});

	it('formats all-summarized community summary detail', () => {
		expect(
			formatConsolidationJobSummaries([
				{
					phase: 'rem',
					job: 'community_summaries',
					ok: true,
					detail: '45 of 45 L1 routing summaries',
					durationMs: 50
				}
			])
		).toEqual(['community summaries: 45 of 45 L1 routing summaries (50ms)']);
	});
});

describe('formatConsolidationJobErrors', () => {
	it('returns readable lines for failed jobs', () => {
		expect(
			formatConsolidationJobErrors([
				{ phase: 'deep_sleep', job: 'ontology_prune', ok: false, detail: 'prune failed', durationMs: 1 },
				{ phase: 'rem', job: 'community_summaries', ok: true, durationMs: 2 }
			])
		).toEqual(['ontology prune: prune failed']);
	});
});

describe('consolidateForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs DeepSleep jobs before REM jobs', async () => {
		const result = await consolidateForUser('u1');

		expect(withDbUserMock).toHaveBeenCalledWith('u1', expect.any(Function));
		expect(salienceComputeMock).toHaveBeenCalledWith('u1');
		expect(pruneMock).toHaveBeenCalled();
		expect(repairTypesMock).toHaveBeenCalledWith('u1');
		expect(dedupEntitiesMock).toHaveBeenCalledWith('u1');
		expect(repairRelationsMock).toHaveBeenCalledWith('u1', expect.objectContaining({ shouldCancel: expect.any(Function) }));
		expect(runDetectionMock).toHaveBeenCalledWith('u1');
		expect(runSummariesMock).toHaveBeenCalledWith('u1', expect.objectContaining({ shouldCancel: expect.any(Function) }));

		const phases = result.jobs.map((j) => j.phase);
		const deepSleepEnd = phases.lastIndexOf('deep_sleep');
		const remStart = phases.indexOf('rem');
		expect(deepSleepEnd).toBeGreaterThanOrEqual(0);
		expect(remStart).toBeGreaterThan(deepSleepEnd);
	});

	it('skips summaries when community detection fails', async () => {
		runDetectionMock.mockRejectedValueOnce(new Error('graph error'));

		const result = await consolidateForUser('u1');

		expect(runDetectionMock).toHaveBeenCalledWith('u1');
		expect(runSummariesMock).not.toHaveBeenCalled();
		expect(result.jobs.find((j) => j.job === 'community_detection')?.ok).toBe(false);
	});

	it('skips summaries when communities are unchanged', async () => {
		runDetectionMock.mockResolvedValueOnce({ totalCommunities: 12, changed: false });

		const result = await consolidateForUser('u1');

		expect(runSummariesMock).not.toHaveBeenCalled();
		const summariesJob = result.jobs.find((j) => j.job === 'community_summaries');
		expect(summariesJob?.ok).toBe(true);
		expect(summariesJob?.detail).toContain('skipped (communities unchanged)');
	});

	it('continues REM when a DeepSleep job fails', async () => {
		pruneMock.mockRejectedValueOnce(new Error('prune failed'));

		const result = await consolidateForUser('u1');

		const pruneJob = result.jobs.find((j) => j.job === 'ontology_prune');
		expect(pruneJob?.ok).toBe(false);
		expect(runDetectionMock).toHaveBeenCalled();
	});

	it('marks community summaries failed only on contract/provider failure', async () => {
		runSummariesMock.mockResolvedValueOnce({
			total: 24,
			summarized: 20,
			generated: 20,
			pending: 4,
			deferred: 4,
			failed: false
		});

		const result = await consolidateForUser('u1');
		const summariesJob = result.jobs.find((j) => j.job === 'community_summaries');
		expect(summariesJob?.ok).toBe(true);
		expect(summariesJob?.detail).toContain('deferred');
		expect(summariesJob?.detail).toContain('will resume next run');
	});

	it('marks community summaries failed when batch generation fails', async () => {
		runSummariesMock.mockResolvedValueOnce({
			total: 24,
			summarized: 10,
			generated: 8,
			pending: 14,
			deferred: 0,
			failed: true
		});

		const result = await consolidateForUser('u1');
		const summariesJob = result.jobs.find((j) => j.job === 'community_summaries');
		expect(summariesJob?.ok).toBe(false);
	});
});
