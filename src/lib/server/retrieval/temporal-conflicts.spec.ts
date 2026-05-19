import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	findTemporalSchedulingConflictsInPostgres,
	isSchedulingConflictQuery
} from './temporal-conflicts';

const { getDbMock, findTemporalSchedulingConflictsInGraphMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	findTemporalSchedulingConflictsInGraphMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/graph/falkor', () => ({
	findTemporalSchedulingConflictsInGraph: findTemporalSchedulingConflictsInGraphMock
}));

describe('isSchedulingConflictQuery', () => {
	it('detects scheduling conflict phrasing', () => {
		expect(isSchedulingConflictQuery('Is there a scheduling conflict I should know about?')).toBe(
			true
		);
		expect(isSchedulingConflictQuery('What is the capital of France?')).toBe(false);
	});
});

describe('findTemporalSchedulingConflictsInPostgres', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findTemporalSchedulingConflictsInGraphMock.mockResolvedValue([]);
	});

	it('returns a conflict when overlapping events share a person but different places', async () => {
		const executeMock = vi
			.fn()
			.mockResolvedValueOnce([
				{
					event1Id: 'ev1',
					thought1Id: 't1',
					summary1: 'Tom is moving to Lisbon in March',
					event2Id: 'ev2',
					thought2Id: 't2',
					summary2: 'Team offsite in Berlin in March'
				}
			])
			.mockResolvedValueOnce([]);

		const selectMock = vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([
						{
							thoughtId: 't1',
							entityId: 'ent-tom',
							label: 'Tom',
							entityType: 'person'
						},
						{
							thoughtId: 't1',
							entityId: 'ent-lisbon',
							label: 'Lisbon',
							entityType: 'place'
						},
						{
							thoughtId: 't2',
							entityId: 'ent-tom',
							label: 'Tom',
							entityType: 'person'
						},
						{
							thoughtId: 't2',
							entityId: 'ent-berlin',
							label: 'Berlin',
							entityType: 'place'
						}
					])
				})
			})
		});

		const mandatorySelect = vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([{ thoughtId: 't3' }])
				})
			})
		});

		getDbMock.mockReturnValue({
			execute: executeMock,
			select: vi
				.fn()
				.mockImplementationOnce(() => selectMock())
				.mockImplementationOnce(() => mandatorySelect())
		});

		const conflicts = await findTemporalSchedulingConflictsInPostgres({
			userId: 'u1',
			query: 'March scheduling conflict'
		});

		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]!.personLabel).toBe('Tom');
		expect(conflicts[0]!.thoughtIds).toEqual(expect.arrayContaining(['t1', 't2', 't3']));
		expect(conflicts[0]!.events.map((e) => e.placeLabel).sort()).toEqual(['Berlin', 'Lisbon']);
	});
});
