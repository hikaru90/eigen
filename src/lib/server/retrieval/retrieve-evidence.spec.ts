import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retrieveEvidence } from './retrieve-evidence';

const {
	createThoughtEmbeddingMock,
	getDbMock,
	lexicalSearchMock,
	matchCanonicalEntitiesByEmbeddingMock,
	rerankCandidatesMock,
	decryptTenantValueMock,
	isTemporalQueryMock,
	filterTemporalEventsMock,
	isSchedulingConflictQueryMock,
	findTemporalSchedulingConflictsMock
} = vi.hoisted(() => ({
	createThoughtEmbeddingMock: vi.fn(),
	getDbMock: vi.fn(),
	lexicalSearchMock: vi.fn(),
	matchCanonicalEntitiesByEmbeddingMock: vi.fn(),
	rerankCandidatesMock: vi.fn(),
	decryptTenantValueMock: vi.fn(),
	isTemporalQueryMock: vi.fn(),
	filterTemporalEventsMock: vi.fn(),
	isSchedulingConflictQueryMock: vi.fn(),
	findTemporalSchedulingConflictsMock: vi.fn()
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/retrieval/lexical', () => ({
	lexicalSearch: lexicalSearchMock
}));

vi.mock('$lib/server/memory/entity-resolution', () => ({
	matchCanonicalEntitiesByEmbedding: matchCanonicalEntitiesByEmbeddingMock
}));

vi.mock('$lib/server/retrieval/reranker', () => ({
	rerankCandidates: rerankCandidatesMock
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	decryptTenantValue: decryptTenantValueMock
}));

vi.mock('$lib/server/retrieval/temporal', () => ({
	isTemporalQuery: isTemporalQueryMock,
	filterTemporalEvents: filterTemporalEventsMock
}));

vi.mock('$lib/server/retrieval/temporal-conflicts', () => ({
	isSchedulingConflictQuery: isSchedulingConflictQueryMock,
	findTemporalSchedulingConflicts: findTemporalSchedulingConflictsMock
}));

function makeSequentialDb(selectQueues: unknown[][]) {
	let selectIndex = 0;
	const nextRows = () => selectQueues[selectIndex++] ?? [];

	const limit = vi.fn(async () => nextRows());
	const orderBy = vi.fn(() => ({ limit }));
	const innerJoinWhere = vi.fn(() => ({ orderBy }));
	const innerJoin = vi.fn(() => ({ where: innerJoinWhere }));
	const where = vi.fn(() => ({ orderBy, innerJoin }));
	const from = vi.fn(() => ({ where, innerJoin }));

	return {
		select: vi.fn(() => ({ from })),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async () => undefined)
			}))
		}))
	};
}

const thoughtRow = {
	id: 't1',
	normalizedText: 'plain text',
	normalizedTextEncrypted: null,
	rerankSnippet: 'snippet',
	category: 'thought',
	memoryType: 'fact',
	metadata: { k: 'v' },
	metadataEncrypted: null,
	createdAt: new Date('2026-06-01T10:00:00.000Z'),
	salienceScore: 2,
	entityCentralityMax: 0.5,
	specificityScore: 0.3,
	recencyBucket: 0.8,
	bundleRank: 0,
	primaryCommunityIds: ['c1', 'c1', 'c2'],
	embedding: [0.1, 0.2]
};

describe('retrieveEvidence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2]);
		lexicalSearchMock.mockResolvedValue([]);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([]);
		isTemporalQueryMock.mockReturnValue(false);
		filterTemporalEventsMock.mockResolvedValue([]);
		isSchedulingConflictQueryMock.mockReturnValue(false);
		findTemporalSchedulingConflictsMock.mockResolvedValue([]);
		rerankCandidatesMock.mockImplementation(async (_u, _q, c) => c);
		decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
			Promise.resolve(ciphertext)
		);
	});

	it('uses provided queryEmbedding without re-embedding', async () => {
		getDbMock.mockReturnValue(makeSequentialDb([[], [], []]));

		await retrieveEvidence({
			userId: 'u1',
			query: 'cached',
			queryEmbedding: [0.5, 0.6]
		});

		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});

	it('returns [] when no candidates are found', async () => {
		getDbMock.mockReturnValue(makeSequentialDb([[], []]));

		const result = await retrieveEvidence({ userId: 'u1', query: 'nothing' });
		expect(result).toEqual([]);
	});

	it('merges vector, lexical, community, entity, neighbor, and temporal hits', async () => {
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([
			{ id: 'e1', distance: 0.2 },
			{ id: 'e2', distance: 0.9 }
		]);
		lexicalSearchMock.mockResolvedValue([{ id: 't2' }]);
		isTemporalQueryMock.mockReturnValue(true);
		filterTemporalEventsMock.mockResolvedValue([{ thoughtId: 't3' }]);
		isSchedulingConflictQueryMock.mockReturnValue(true);
		findTemporalSchedulingConflictsMock.mockResolvedValue([{ thoughtIds: ['t4'] }]);

		getDbMock.mockReturnValue(
			makeSequentialDb([
				[{ id: 't1', distance: 0.1 }],
				[{ communityId: 'c1', distance: 0.15 }],
				[{ communityId: 'c1', topThoughtIds: ['t5'] }],
				[{ entityId: 'e1', thoughtIds: ['t6', 't7'] }],
				[{ thoughtId: 't1', neighborId: 't8', weight: 1 }],
				[thoughtRow]
			])
		);

		const result = await retrieveEvidence({ userId: 'u1', query: 'schedule conflict', topK: 3 });

		expect(result.length).toBeGreaterThan(0);
		expect(result[0]).toEqual(
			expect.objectContaining({
				id: 't1',
				normalizedText: 'plain text',
				category: 'thought'
			})
		);
		expect(rerankCandidatesMock).toHaveBeenCalled();
	});

	it('decrypts encrypted thought fields and sets graph provenance', async () => {
		decryptTenantValueMock.mockImplementation(async ({ column }: { column: string }) => {
			if (column === 'normalized_text') return 'decrypted body';
			return JSON.stringify({ secret: true });
		});

		const encryptedRow = {
			...thoughtRow,
			normalizedText: null,
			normalizedTextEncrypted: 'cipher-text',
			metadata: null,
			metadataEncrypted: 'cipher-meta',
			rerankSnippet: null
		};

		getDbMock.mockReturnValue(
			makeSequentialDb([
				[{ id: 't1', distance: 0.05 }],
				[],
				[encryptedRow]
			])
		);

		const result = await retrieveEvidence({ userId: 'u1', query: 'secret' });

		expect(result[0]?.normalizedText).toBe('decrypted body');
		expect(result[0]?.metadata).toEqual(expect.objectContaining({ secret: true }));
		expect(decryptTenantValueMock).toHaveBeenCalled();
	});

	it('creates query embedding when not provided', async () => {
		getDbMock.mockReturnValue(makeSequentialDb([[], []]));

		await retrieveEvidence({ userId: 'u1', query: 'fresh query' });

		expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'fresh query');
	});

	it('logs salience bump failures without failing retrieval', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		getDbMock.mockReturnValue({
			...makeSequentialDb([[{ id: 't1', distance: 0.05 }], [], [thoughtRow]]),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(async () => {
						throw new Error('db down');
					})
				}))
			}))
		});

		const result = await retrieveEvidence({ userId: 'u1', query: 'hello' });
		expect(result).toHaveLength(1);
		expect(warnSpy).toHaveBeenCalledWith(
			'[retrieval.reconsolidation] salience bump failed',
			expect.objectContaining({ userId: 'u1' })
		);
		warnSpy.mockRestore();
	});
});
