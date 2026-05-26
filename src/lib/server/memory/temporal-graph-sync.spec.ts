import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncTemporalEventsFromThought } from './temporal-graph-sync';

const {
	extractTemporalMentionsMock,
	createThoughtEmbeddingMock,
	processPendingGraphSyncJobsMock,
	getDbMock
} = vi.hoisted(() => ({
	extractTemporalMentionsMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	processPendingGraphSyncJobsMock: vi.fn(),
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/memory/temporal-extraction', () => ({
	extractTemporalMentions: extractTemporalMentionsMock
}));
vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));
vi.mock('$lib/server/graph/graph-sync-worker', () => ({
	processPendingGraphSyncJobs: processPendingGraphSyncJobsMock
}));
vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

const sampleMention = {
	surface: 'due Friday',
	kind: 'deadline' as const,
	startAt: '2026-05-22T00:00:00.000Z',
	timePrecision: 'day' as const,
	timezone: 'UTC',
	isAllDay: true,
	confidence: 0.9,
	semanticSummary: 'Report due Friday'
};

function makeDb(existingRows: Array<{ id: string; falkordbNodeId: string | null }> = []) {
	const deleteWhere = vi.fn(async () => undefined);
	const deleteFn = vi.fn(() => ({ where: deleteWhere }));

	const insertReturning = vi.fn();
	const insertValues = vi.fn(() => ({ returning: insertReturning }));
	const insertFn = vi.fn(() => ({ values: insertValues }));

	const selectWhere = vi.fn(async () => existingRows);
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const selectFn = vi.fn(() => ({ from: selectFrom }));

	const tx = {
		delete: deleteFn,
		insert: insertFn
	};

	return {
		select: selectFn,
		delete: deleteFn,
		insert: insertFn,
		transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
		insertReturning,
		insertValues,
		deleteWhere,
		selectWhere
	};
}

describe('syncTemporalEventsFromThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		processPendingGraphSyncJobsMock.mockResolvedValue(undefined);
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2]);
	});

	it('returns early when extraction finds no temporal mentions', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractTemporalMentionsMock.mockResolvedValue([]);

		await syncTemporalEventsFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'plain note'
		});

		expect(extractTemporalMentionsMock).toHaveBeenCalled();
		expect(db.transaction).not.toHaveBeenCalled();
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});

	it('deletes existing temporal rows and enqueues graph deletes before inserting new mentions', async () => {
		const db = makeDb([{ id: 'ev-old', falkordbNodeId: 'node-1' }]);
		getDbMock.mockReturnValue(db);
		extractTemporalMentionsMock.mockResolvedValue([sampleMention]);

		db.insertReturning
			.mockResolvedValueOnce([{ id: 'ev-new' }])
			.mockResolvedValueOnce([{ id: 'job-1' }]);

		await syncTemporalEventsFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Report due Friday',
			thoughtEmbedding: [0.5, 0.6],
			timezone: 'UTC'
		});

		expect(db.transaction).toHaveBeenCalledTimes(2);
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(processPendingGraphSyncJobsMock).toHaveBeenCalled();
	});
});
