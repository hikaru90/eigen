import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterTemporalEvents, inferQueryTimeRange, isTemporalQuery, resolveQueryTimeRange, traverseTemporalContext } from './temporal';

const { getDbMock, createThoughtEmbeddingMock, expandContextFromTemporalEventSeedsMock } =
	vi.hoisted(() => ({
		getDbMock: vi.fn(),
		createThoughtEmbeddingMock: vi.fn(),
		expandContextFromTemporalEventSeedsMock: vi.fn()
	}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));
vi.mock('$lib/server/graph/age', () => ({
	expandContextFromTemporalEventSeeds: expandContextFromTemporalEventSeedsMock
}));

describe('isTemporalQuery', () => {
	it('returns true when LLM intent marks temporal', () => {
		expect(isTemporalQuery({ temporal: true, kind: 'ordering', timeWindow: null })).toBe(true);
	});

	it('returns false when intent is absent or non-temporal', () => {
		expect(isTemporalQuery(null)).toBe(false);
		expect(isTemporalQuery({ temporal: false, kind: 'none', timeWindow: null })).toBe(false);
	});
});

describe('resolveQueryTimeRange', () => {
	it('returns time window from LLM intent', () => {
		const window = {
			start: new Date('2026-05-01T00:00:00.000Z'),
			end: new Date('2026-06-01T00:00:00.000Z')
		};
		expect(resolveQueryTimeRange({ temporal: true, kind: 'absolute', timeWindow: window })).toEqual(
			window
		);
	});

	it('returns null when intent has no window', () => {
		expect(resolveQueryTimeRange({ temporal: true, kind: 'ordering', timeWindow: null })).toBeNull();
	});
});

describe('inferQueryTimeRange', () => {
	it('always returns null — query time windows come from LLM intent', () => {
		expect(inferQueryTimeRange('events in 2026')).toBeNull();
	});
});

describe('filterTemporalEvents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2]);
	});

	it('returns ranked temporal events from Postgres', async () => {
		const limit = vi.fn(async () => [
			{
				id: 'ev1',
				graphNodeId: 'node-1',
				semanticSummary: 'Team offsite',
				thoughtId: 't1',
				distance: 0.2
			}
		]);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		const rows = await filterTemporalEvents({
			userId: 'u1',
			query: 'events in May 2026',
			queryEmbedding: [0.5, 0.6]
		});

		expect(rows).toEqual([
			expect.objectContaining({
				eventId: 'ev1',
				thoughtId: 't1',
				score: 1
			})
		]);
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});

	it('embeds the query and applies an inferred time range when none is supplied', async () => {
		const limit = vi.fn(async () => [
			{
				id: 'ev1',
				graphNodeId: null,
				semanticSummary: 'May planning session',
				thoughtId: 't1',
				distance: 0.1
			}
		]);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });
		createThoughtEmbeddingMock.mockResolvedValue([0.3, 0.4]);

		const rows = await filterTemporalEvents({
			userId: 'u1',
			query: 'events in May 2026'
		});

		expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'events in May 2026');
		expect(rows[0]?.eventId).toBe('ev1');
		expect(rows[0]?.graphNodeId).toBeNull();
	});

	it('uses explicit queryRange without inferring from text', async () => {
		const limit = vi.fn(async () => []);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		await filterTemporalEvents({
			userId: 'u1',
			query: 'any query',
			queryEmbedding: [0.1, 0.2],
			queryRange: {
				start: new Date('2026-05-01T00:00:00.000Z'),
				end: new Date('2026-06-01T00:00:00.000Z')
			}
		});

		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});

	it('searches without a time-range filter when no window can be inferred', async () => {
		const limit = vi.fn(async () => []);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		await filterTemporalEvents({
			userId: 'u1',
			query: 'random thoughts about bread',
			queryEmbedding: [0.1, 0.2]
		});

		expect(where).toHaveBeenCalled();
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});

	it('honors an explicit null queryRange override', async () => {
		const limit = vi.fn(async () => []);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		await filterTemporalEvents({
			userId: 'u1',
			query: 'events in May 2026',
			queryEmbedding: [0.1, 0.2],
			queryRange: null
		});

		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});
});

describe('traverseTemporalContext', () => {
	it('returns [] when seeds have no ids', async () => {
		await expect(
			traverseTemporalContext({
				userId: 'u1',
				seeds: []
			})
		).resolves.toEqual([]);
	});

	it('delegates to AGE graph expansion for seeded events', async () => {
		expandContextFromTemporalEventSeedsMock.mockResolvedValue([
			{ thoughtId: 't1', hits: 2, provenance: 'temporal' }
		]);

		const rows = await traverseTemporalContext({
			userId: 'u1',
			seeds: [
				{
					eventId: 'ev1',
					graphNodeId: 'node-1',
					semanticSummary: 'Meeting',
					thoughtId: 't1',
					score: 1
				}
			]
		});

		expect(expandContextFromTemporalEventSeedsMock).toHaveBeenCalledWith({
			userId: 'u1',
			eventIds: ['node-1'],
			limit: 40
		});
		expect(rows).toHaveLength(1);
	});

	it('falls back to eventId when graphNodeId is missing', async () => {
		expandContextFromTemporalEventSeedsMock.mockResolvedValue([]);

		await traverseTemporalContext({
			userId: 'u1',
			seeds: [
				{
					eventId: 'ev-only',
					graphNodeId: null,
					semanticSummary: 'Meeting',
					thoughtId: 't1',
					score: 1
				}
			]
		});

		expect(expandContextFromTemporalEventSeedsMock).toHaveBeenCalledWith({
			userId: 'u1',
			eventIds: ['ev-only'],
			limit: 40
		});
	});
});
