import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	withDbUserMock,
	runSalienceDecayMock,
	pruneMock,
	repairMock,
	shouldDetectMock,
	runDetectionMock,
	runSummariesMock,
	boostOpenLoopMock
} = vi.hoisted(() => ({
	withDbUserMock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => fn()),
	runSalienceDecayMock: vi.fn().mockResolvedValue(0),
	pruneMock: vi.fn().mockResolvedValue({ deletedEntityKindIds: [], deletedRelationKindIds: [] }),
	repairMock: vi.fn().mockResolvedValue({ repaired: 0 }),
	shouldDetectMock: vi.fn().mockResolvedValue(false),
	runDetectionMock: vi.fn().mockResolvedValue({ totalCommunities: 0 }),
	runSummariesMock: vi.fn().mockResolvedValue(0),
	boostOpenLoopMock: vi.fn().mockResolvedValue(0)
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(() => ({
		select: vi.fn(() => ({
			from: vi.fn(async () => [])
		}))
	})),
	withDbUser: withDbUserMock
}));

vi.mock('./salience-decay', () => ({ runSalienceDecay: runSalienceDecayMock }));
vi.mock('$lib/server/ontology-db', () => ({ pruneUnusedOntologyEntityKinds: pruneMock }));
vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
	repairCanonicalEntityTypesForUser: repairMock
}));
vi.mock('./community-detection', () => ({
	shouldRunCommunityDetection: shouldDetectMock,
	runCommunityDetection: runDetectionMock
}));
vi.mock('./community-summaries', () => ({
	runCommunitySummaryGeneration: runSummariesMock
}));
vi.mock('./open-loop-salience', () => ({ boostOpenLoopSalience: boostOpenLoopMock }));

import { consolidateForUser, formatConsolidationJobErrors } from './runner';

describe('formatConsolidationJobErrors', () => {
	it('returns readable lines for failed jobs', () => {
		expect(
			formatConsolidationJobErrors([
				{ phase: 'deep_sleep', job: 'salience_decay', ok: false, detail: 'decay failed', durationMs: 1 },
				{ phase: 'rem', job: 'open_loop_salience', ok: true, durationMs: 2 }
			])
		).toEqual(['salience decay: decay failed']);
	});
});

describe('consolidateForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		shouldDetectMock.mockResolvedValue(false);
	});

	it('runs DeepSleep jobs before REM jobs', async () => {
		const result = await consolidateForUser('u1');

		expect(withDbUserMock).toHaveBeenCalledWith('u1', expect.any(Function));
		expect(runSalienceDecayMock).toHaveBeenCalledWith('u1');
		expect(pruneMock).toHaveBeenCalled();
		expect(repairMock).toHaveBeenCalledWith('u1');
		expect(runSummariesMock).toHaveBeenCalledWith('u1');
		expect(boostOpenLoopMock).toHaveBeenCalledWith('u1');
		expect(runDetectionMock).not.toHaveBeenCalled();

		const phases = result.jobs.map((j) => j.phase);
		const deepSleepEnd = phases.lastIndexOf('deep_sleep');
		const remStart = phases.indexOf('rem');
		expect(deepSleepEnd).toBeGreaterThanOrEqual(0);
		expect(remStart).toBeGreaterThan(deepSleepEnd);
	});

	it('runs community detection when shouldRunCommunityDetection is true', async () => {
		shouldDetectMock.mockResolvedValueOnce(true);
		runDetectionMock.mockResolvedValueOnce({ totalCommunities: 3 });

		await consolidateForUser('u1');

		expect(runDetectionMock).toHaveBeenCalledWith('u1');
		expect(runSummariesMock).toHaveBeenCalledWith('u1');
	});

	it('continues REM when a DeepSleep job fails', async () => {
		runSalienceDecayMock.mockRejectedValueOnce(new Error('decay failed'));

		const result = await consolidateForUser('u1');

		const decayJob = result.jobs.find((j) => j.job === 'salience_decay');
		expect(decayJob?.ok).toBe(false);
		expect(boostOpenLoopMock).toHaveBeenCalled();
	});
});
