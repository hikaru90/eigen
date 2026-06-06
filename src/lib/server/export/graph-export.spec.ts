import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildGraphExportJson } from './graph-export';

const {
	getDbMock,
	fetchEntityEdgesForUserMock,
	fetchOccursInEdgesForUserMock,
	fetchInvolvesEdgesForUserMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	fetchEntityEdgesForUserMock: vi.fn(),
	fetchOccursInEdgesForUserMock: vi.fn(),
	fetchInvolvesEdgesForUserMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/graph/age', () => ({
	fetchEntityEdgesForUser: fetchEntityEdgesForUserMock,
	fetchOccursInEdgesForUser: fetchOccursInEdgesForUserMock,
	fetchInvolvesEdgesForUser: fetchInvolvesEdgesForUserMock
}));

/** Indices of Postgres queries that chain `.orderBy()` before awaiting. */
const ORDER_BY_QUERY_INDICES = new Set([0, 1, 4]);

function makeSelectChain(rows: unknown[], queryIndex: number) {
	const orderBy = vi.fn(async () => rows);
	const where = vi.fn(() =>
		ORDER_BY_QUERY_INDICES.has(queryIndex) ? { orderBy } : Promise.resolve(rows)
	);
	const from = vi.fn(() => ({ where }));
	return { from };
}

beforeEach(() => {
	getDbMock.mockReset();
	fetchEntityEdgesForUserMock.mockReset();
	fetchOccursInEdgesForUserMock.mockReset();
	fetchInvolvesEdgesForUserMock.mockReset();
});

describe('buildGraphExportJson', () => {
	it('returns import-script-compatible shape with counts', async () => {
		const createdAt = new Date('2026-05-26T10:00:00.000Z');
		const startAt = new Date('2026-06-01T09:00:00.000Z');
		const endAt = new Date('2026-06-01T10:00:00.000Z');

		const selectResults = [
			[{ id: 't1', category: 'task' }],
			[
				{
					id: 'e1',
					canonicalKey: 'jonas',
					label: 'Jonas',
					entityType: 'person'
				}
			],
			[
				{
					sourceThoughtId: 't1',
					targetThoughtId: 't2',
					relationType: 'related_to'
				}
			],
			[{ thoughtId: 't1', entityId: 'e1' }],
			[
				{
					id: 'ev1',
					kind: 'appointment',
					semanticSummary: 'Meeting with Jonas',
					startAt,
					endAt
				}
			]
		];

		let call = 0;
		getDbMock.mockReturnValue({
			select: vi.fn(() => {
				const idx = call++;
				return makeSelectChain(selectResults[idx] ?? [], idx);
			})
		});

		fetchEntityEdgesForUserMock.mockResolvedValue([
			{ sourceId: 'e1', targetId: 'e2', weight: 2, predicate: 'knows' }
		]);
		fetchOccursInEdgesForUserMock.mockResolvedValue([{ thoughtId: 't1', eventId: 'ev1' }]);
		fetchInvolvesEdgesForUserMock.mockResolvedValue([{ eventId: 'ev1', entityId: 'e1' }]);

		const payload = await buildGraphExportJson('u1');

		expect(payload.userId).toBe('u1');
		expect(payload.thoughts).toEqual([{ id: 't1', category: 'task' }]);
		expect(payload.entities).toEqual([
			{ id: 'e1', canonical_key: 'jonas', label: 'Jonas', entity_type: 'person' }
		]);
		expect(payload.relates_to).toEqual([
			{ source_id: 't1', target_id: 't2', relation_type: 'related_to' }
		]);
		expect(payload.mentions).toEqual([{ thought_id: 't1', entity_id: 'e1' }]);
		expect(payload.events[0]).toMatchObject({
			id: 'ev1',
			kind: 'appointment',
			label: 'Meeting with Jonas',
			start_at: startAt.toISOString(),
			end_at: endAt.toISOString()
		});
		expect(payload.entity_relates).toEqual([
			{ source_id: 'e1', target_id: 'e2', predicate: 'knows', weight: 2 }
		]);
		expect(payload.occurs_in).toEqual([{ thought_id: 't1', event_id: 'ev1' }]);
		expect(payload.involves).toEqual([{ event_id: 'ev1', entity_id: 'e1' }]);
		expect(payload.counts).toEqual({
			thoughts: 1,
			entities: 1,
			events: 1,
			relates_to: 1,
			mentions: 1,
			entity_relates: 1,
			occurs_in: 1,
			involves: 1
		});

		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain('embedding');
	});
});
