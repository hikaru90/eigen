import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	backfillRetrievalLinksForUser,
	materializeRetrievalLinksForThought,
	rebuildEntityTopThoughtsForEntities,
	rebuildEntityTopThoughtsForThought,
	syncThoughtEntityLinks,
	syncThoughtNeighborLinks,
	syncThoughtRerankSnippet
} from './materialize-links';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));

function makeDb(handlers: {
	selectWhere?: unknown;
	selectOrderLimit?: unknown;
	insertValues?: ReturnType<typeof vi.fn>;
}) {
	const insertValues =
		handlers.insertValues ??
		vi.fn(() => ({
			onConflictDoUpdate: vi.fn(async () => undefined)
		}));

	return {
		delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: vi.fn(async () => undefined) }))
		})),
		insert: vi.fn(() => ({ values: insertValues })),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(async () => handlers.selectWhere ?? []),
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(async () => handlers.selectOrderLimit ?? [])
						}))
					}))
				}))
			}))
		}))
	};
}

describe('materialize-links', () => {
	beforeEach(() => vi.clearAllMocks());

	it('syncThoughtEntityLinks returns 0 when no resolution logs exist', async () => {
		const deleteWhere = vi.fn(async () => undefined);
		getDbMock.mockReturnValue({
			...makeDb({ selectWhere: [] }),
			delete: vi.fn(() => ({ where: deleteWhere }))
		});

		await expect(syncThoughtEntityLinks('u1', 't1')).resolves.toBe(0);
		expect(deleteWhere).toHaveBeenCalled();
	});

	it('syncThoughtEntityLinks dedupes entities and keeps max salience', async () => {
		const insertValues = vi.fn(async () => undefined);
		getDbMock.mockReturnValue(
			makeDb({
				selectWhere: [
					{ entityId: 'e1', confidence: 'medium' },
					{ entityId: 'e1', confidence: 'high' },
					{ entityId: 'e2', confidence: 'low' }
				],
				insertValues
			})
		);

		await expect(syncThoughtEntityLinks('u1', 't1')).resolves.toBe(2);
		expect(insertValues).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ entityId: 'e1', salience: 1 }),
				expect.objectContaining({ entityId: 'e2', salience: 0.4 })
			])
		);
	});

	it('syncThoughtNeighborLinks returns 0 when no relations exist', async () => {
		getDbMock.mockReturnValue(makeDb({ selectWhere: [] }));
		await expect(syncThoughtNeighborLinks('u1', 't1')).resolves.toBe(0);
	});

	it('syncThoughtNeighborLinks inserts neighbor rows', async () => {
		const insertValues = vi.fn(async () => undefined);
		getDbMock.mockReturnValue(
			makeDb({
				selectWhere: [{ targetThoughtId: 't2', relationType: 'related_to' }],
				insertValues
			})
		);

		await expect(syncThoughtNeighborLinks('u1', 't1')).resolves.toBe(1);
		expect(insertValues).toHaveBeenCalled();
	});

	it('syncThoughtRerankSnippet trims and caps snippet length', async () => {
		const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
		getDbMock.mockReturnValue({
			update: vi.fn(() => ({ set }))
		});

		const longText = 'x'.repeat(400);
		await syncThoughtRerankSnippet('u1', 't1', `  ${longText}  `);

		expect(set).toHaveBeenCalledWith({ rerankSnippet: 'x'.repeat(300) });
	});

	it('rebuildEntityTopThoughtsForThought no-ops without entity links', async () => {
		getDbMock.mockReturnValue(makeDb({ selectWhere: [] }));
		await rebuildEntityTopThoughtsForThought('u1', 't1');
		expect(getDbMock).toHaveBeenCalledTimes(1);
	});

	it('rebuildEntityTopThoughtsForEntities upserts ranked thought ids', async () => {
		const insertValues = vi.fn(() => ({
			onConflictDoUpdate: vi.fn(async () => undefined)
		}));
		getDbMock.mockReturnValue(
			makeDb({
				selectOrderLimit: [
					{
						thoughtId: 't1',
						salience: 0.9,
						createdAt: new Date('2026-06-01T00:00:00.000Z'),
						thoughtSalience: 1.2
					}
				],
				insertValues
			})
		);

		await rebuildEntityTopThoughtsForEntities('u1', ['e1']);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				entityId: 'e1',
				thoughtIds: ['t1']
			})
		);
	});

	it('materializeRetrievalLinksForThought runs all sync steps', async () => {
		getDbMock.mockReturnValue(makeDb({ selectWhere: [] }));
		await materializeRetrievalLinksForThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello world'
		});
		expect(getDbMock).toHaveBeenCalled();
	});

	it('backfillRetrievalLinksForUser processes all thoughts and entities', async () => {
		let selectCall = 0;
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			update: vi.fn(() => ({
				set: vi.fn(() => ({ where: vi.fn(async () => undefined) }))
			})),
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflictDoUpdate: vi.fn(async () => undefined)
				}))
			})),
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => {
						selectCall++;
						if (selectCall === 1) return [{ id: 't1', normalizedText: 'one' }];
						return [{ entityId: 'e1' }, { entityId: 'e1' }];
					}),
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(async () => [])
							}))
						}))
					}))
				}))
			}))
		});

		const result = await backfillRetrievalLinksForUser('u1');
		expect(result.thoughts).toBe(1);
		expect(result.entities).toBe(1);
	});
});
