import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichThought, reenrichThought } from './enrich';

const {
	getDbMock,
	extractRelationsMock,
	syncEntityGraphFromThoughtMock,
	classifyMemoryTypeMock,
	extractCuesMock,
	maybeRefreshUserOntologyMock,
	upsertThoughtRelationMock,
	deleteThoughtOutgoingGraphEdgesMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	extractRelationsMock: vi.fn(),
	syncEntityGraphFromThoughtMock: vi.fn(),
	classifyMemoryTypeMock: vi.fn(),
	extractCuesMock: vi.fn(),
	maybeRefreshUserOntologyMock: vi.fn(),
	upsertThoughtRelationMock: vi.fn(),
	deleteThoughtOutgoingGraphEdgesMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/memory/relation-extraction', () => ({ extractRelations: extractRelationsMock }));
vi.mock('$lib/server/memory/entity-graph-sync', () => ({ syncEntityGraphFromThought: syncEntityGraphFromThoughtMock }));
vi.mock('$lib/server/memory/classify-memory-type', () => ({ classifyMemoryType: classifyMemoryTypeMock }));
vi.mock('$lib/server/memory/extract-cues', () => ({ extractCues: extractCuesMock }));
vi.mock('$lib/server/ontology', () => ({ maybeRefreshUserOntology: maybeRefreshUserOntologyMock }));
vi.mock('$lib/server/graph/falkor', () => ({
	upsertThoughtRelation: upsertThoughtRelationMock,
	deleteThoughtOutgoingGraphEdges: deleteThoughtOutgoingGraphEdgesMock
}));

function makeDb(overrides: Partial<{
	updateResult: unknown;
	transactionResult: unknown;
}> = {}) {
	const updateChain = {
		set: vi.fn(() => ({
			where: vi.fn(async () => overrides.updateResult ?? undefined)
		}))
	};
	return {
		update: vi.fn(() => updateChain),
		transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
			cb({
				delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
				insert: vi.fn(() => ({ values: vi.fn(async () => []) }))
			})
		)
	};
}

describe('enrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue(undefined);
		classifyMemoryTypeMock.mockResolvedValue('episode');
		extractCuesMock.mockResolvedValue(['cue one', 'cue two']);
		maybeRefreshUserOntologyMock.mockResolvedValue(undefined);
	});

	it('increments enrichment_version on entry regardless of step outcomes', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello world');

		// First update call is the enrichment_version bump
		expect(db.update).toHaveBeenCalled();
	});

	it('calls relation extraction and syncs relations to DB and FalkorDB', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractRelationsMock.mockResolvedValue([
			{ targetId: 'target-1', relationType: 'related_to' }
		]);

		await enrichThought('u1', 't1', 'hello world');

		expect(extractRelationsMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello world'
		});
		expect(upsertThoughtRelationMock).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: 't1', targetId: 'target-1' })
		);
	});

	it('calls entity graph sync', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello world', { thoughtEmbedding: [0.1, 0.2] });

		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello world',
			thoughtEmbedding: [0.1, 0.2]
		});
	});

	it('classifies and persists memory type', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'I decided to go with option B');

		expect(classifyMemoryTypeMock).toHaveBeenCalledWith({
			userId: 'u1',
			normalizedText: 'I decided to go with option B'
		});
	});

	it('extracts and persists cues', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractCuesMock.mockResolvedValue(['option B decision', 'choice made']);

		await enrichThought('u1', 't1', 'hello world');

		expect(extractCuesMock).toHaveBeenCalledWith({
			userId: 'u1',
			normalizedText: 'hello world'
		});
	});

	it('triggers ontology refresh when thoughtCountAfterInsert is provided', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello', { thoughtCountAfterInsert: 10 });

		expect(maybeRefreshUserOntologyMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', thoughtCountAfterInsert: 10 })
		);
	});

	it('does not call ontology refresh when thoughtCountAfterInsert is absent', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello');

		expect(maybeRefreshUserOntologyMock).not.toHaveBeenCalled();
	});

	it('sets enriched_at when all steps succeed', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello');

		// The last update call sets enriched_at (allOk=true path)
		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const enrichedAtCall = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				'enrichedAt' in (args[0] as Record<string, unknown>)
		);
		expect(enrichedAtCall).toBeDefined();
	});

	it('does not set enriched_at when a step fails', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractRelationsMock.mockRejectedValue(new Error('boom'));

		await enrichThought('u1', 't1', 'hello');

		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const enrichedAtCall = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				'enrichedAt' in (args[0] as Record<string, unknown>)
		);
		expect(enrichedAtCall).toBeUndefined();
	});

	it('emits progress phases for each enrichment step', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await enrichThought('u1', 't1', 'hello', {
			onProgress: (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			},
			thoughtCountAfterInsert: 10
		});
		maybeRefreshUserOntologyMock.mock.calls[0]?.[0]?.onBeforeEval?.();

		expect(phases).toContain('relations');
		expect(phases).toContain('entities');
		expect(phases).toContain('memory_type');
		expect(phases).toContain('cues');
	});

	it('continues enriching remaining steps when one step throws', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractRelationsMock.mockRejectedValue(new Error('relations failed'));

		await enrichThought('u1', 't1', 'hello');

		// Subsequent steps should still run despite relations failure
		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalled();
		expect(classifyMemoryTypeMock).toHaveBeenCalled();
		expect(extractCuesMock).toHaveBeenCalled();
	});
});

describe('reenrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue(undefined);
		classifyMemoryTypeMock.mockResolvedValue('fact');
		extractCuesMock.mockResolvedValue([]);
		maybeRefreshUserOntologyMock.mockResolvedValue(undefined);
	});

	it('clears outgoing graph edges before enriching', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await reenrichThought('u1', 't1', 'hello world');

		expect(deleteThoughtOutgoingGraphEdgesMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1'
		});
		// Enrichment still runs
		expect(extractRelationsMock).toHaveBeenCalled();
	});

	it('runs edge clearing before any enrichment step', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		const callOrder: string[] = [];
		deleteThoughtOutgoingGraphEdgesMock.mockImplementation(async () => {
			callOrder.push('delete_edges');
		});
		extractRelationsMock.mockImplementation(async () => {
			callOrder.push('relations');
			return [];
		});

		await reenrichThought('u1', 't1', 'hello world');

		expect(callOrder[0]).toBe('delete_edges');
		expect(callOrder[1]).toBe('relations');
	});
});
