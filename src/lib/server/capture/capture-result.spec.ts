import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadThoughtCaptureResult } from './capture-result';

const { getDbMock, decryptTenantValueMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	decryptTenantValueMock: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
		ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext
	)
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	decryptTenantValue: decryptTenantValueMock
}));

function makeLimitChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		innerJoin: vi.fn(() => chain),
		where: vi.fn(() => chain),
		limit: vi.fn(async () => rows)
	};
	return chain;
}

function makeAwaitableChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		innerJoin: vi.fn(() => chain),
		where: vi.fn(() => chain),
		limit: vi.fn(async () => rows),
		then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
			return Promise.resolve(rows).then(onFulfilled, onRejected);
		}
	};
	return chain;
}

describe('loadThoughtCaptureResult', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns full capture result without embedding fields', async () => {
		const enrichedAt = new Date('2026-06-05T12:00:00.000Z');
		const thoughtRow = {
			id: 't1',
			normalizedText: 'plain normalized',
			normalizedTextEncrypted: 'enc:decrypted normalized',
			category: 'task',
			metadata: {},
			metadataEncrypted: 'enc:{"categoryConfidence":0.82}',
			memoryType: 'open_loop',
			cues: ['header fix'],
			enrichedAt,
			enrichQueueStatus: 'complete'
		};

		getDbMock.mockReturnValue({
			select: vi
				.fn()
				.mockReturnValueOnce(makeLimitChain([thoughtRow]))
				.mockReturnValueOnce(makeAwaitableChain([
						{
							entityId: 'e1',
							label: 'Eigen',
							entityType: 'project',
							mentionSurface: 'Eigen',
							decision: 'merged'
						}
					]))
				.mockReturnValueOnce(makeAwaitableChain([
						{
							id: 'te1',
							kind: 'deadline',
							semanticSummary: 'Ship header fix by Friday'
						}
					]))
				.mockReturnValueOnce(makeAwaitableChain([{ targetThoughtId: 't2', relationType: 'related_to' }]))
				.mockReturnValueOnce(makeLimitChain([{ label: 'Eigen Mesh' }]))
				.mockReturnValueOnce(makeLimitChain([{ projectEntityId: 'e1' }]))
				.mockReturnValueOnce(makeAwaitableChain([
						{
							id: 't2',
							normalizedText: 'old',
							normalizedTextEncrypted: 'enc:linked thought preview text'
						}
					]))
		});

		const result = await loadThoughtCaptureResult('u1', 't1');

		expect(result).toEqual({
			id: 't1',
			normalizedText: 'decrypted normalized',
			category: 'task',
			metadata: { categoryConfidence: 0.82 },
			memoryType: 'open_loop',
			cues: ['header fix'],
			enrichedAt: enrichedAt.toISOString(),
			entities: [
				{
					entityId: 'e1',
					label: 'Eigen',
					entityType: 'project',
					mentionSurface: 'Eigen',
					decision: 'merged'
				}
			],
			temporalEvents: [
				{
					id: 'te1',
					kind: 'deadline',
					semanticSummary: 'Ship header fix by Friday'
				}
			],
			linkedThoughts: [
				{
					thoughtId: 't2',
					relationType: 'related_to',
					preview: 'linked thought preview text'
				}
			],
			enrichmentComplete: true,
			gtdProjectLabel: 'Eigen Mesh',
			gtdIsNextAction: true,
			queueStatus: 'complete',
			queueError: null
		});
		expect(result).not.toHaveProperty('embedding');
	});

	it('returns every entity resolution row including repeated node links', async () => {
		const thoughtRow = {
			id: 't1',
			normalizedText: 'text',
			normalizedTextEncrypted: null,
			category: 'idea',
			metadata: {},
			metadataEncrypted: null,
			memoryType: null,
			cues: [],
			enrichedAt: null
		};

		getDbMock.mockReturnValue({
			select: vi
				.fn()
				.mockReturnValueOnce(makeLimitChain([thoughtRow]))
				.mockReturnValueOnce(
					makeAwaitableChain([
						{
							entityId: 'e1',
							label: 'Eigen',
							entityType: 'project',
							mentionSurface: 'Eigen',
							decision: 'merged'
						},
						{
							entityId: 'e1',
							label: 'Eigen',
							entityType: 'project',
							mentionSurface: 'eigen',
							decision: 'merged'
						}
					])
				)
				.mockReturnValueOnce(makeAwaitableChain([]))
				.mockReturnValueOnce(makeAwaitableChain([]))
				.mockReturnValueOnce(makeLimitChain([]))
				.mockReturnValueOnce(makeLimitChain([]))
		});

		const result = await loadThoughtCaptureResult('u1', 't1');

		expect(result.entities).toHaveLength(2);
		expect(result.entities.map((row) => row.mentionSurface)).toEqual(['Eigen', 'eigen']);
		expect(result.enrichmentComplete).toBe(false);
	});

	it('throws when thought is missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn().mockReturnValue(makeLimitChain([]))
		});

		await expect(loadThoughtCaptureResult('u1', 'missing')).rejects.toThrow(/not found/);
	});
});
