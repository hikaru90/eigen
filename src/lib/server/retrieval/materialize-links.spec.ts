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

function chainSelectRows(rows: unknown[]) {
	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				orderBy: vi.fn(() => ({
					limit: vi.fn(async () => rows)
				})),
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(async () => rows)
						}))
					}))
				}))
			})),
			innerJoin: vi.fn(() => ({
				where: vi.fn(() => ({
					orderBy: vi.fn(() => ({
						limit: vi.fn(async () => rows)
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
			delete: vi.fn(() => ({ where: deleteWhere })),
			select: vi.fn(() => chainSelectRows([])),
			insert: vi.fn()
		});

		await expect(syncThoughtEntityLinks('u1', 't1')).resolves.toBe(0);
		expect(deleteWhere).toHaveBeenCalled();
	});

	it('syncThoughtEntityLinks dedupes entities and keeps max salience', async () => {
		const insert = vi.fn(async () => undefined);
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			select: vi.fn(() =>
				chainSelectRows([
					{ entityId: 'e1', confidence: 'medium' },
					{ entityId: 'e1', confidence: 'high' },
					{ entityId: 'e2', confidence: 'low' }
				])
			),
			insert
		});

		await expect(syncThoughtEntityLinks('u1', 't1')).resolves.toBe(2);
		expect(insert).toHaveBeenCalledWith(
			expect.objectContaining({
				values: expect.arrayContaining([
					expect.objectContaining({ entityId: 'e1', salience: 1 }),
					expect.objectContaining({ entityId: 'e2', salience: 0.4 })
				])
			})
		);
	});

	it('syncThoughtNeighborLinks returns 0 when no relations exist', async () => {
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			select: vi.fn(() => chainSelectRows([])),
			insert: vi.fn()
		});

		await expect(syncThoughtNeighborLinks('u1', 't1')).resolves.toBe(0);
	});

	it('syncThoughtNeighborLinks inserts neighbor rows', async () => {
		const insert = vi.fn(async () => undefined);
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			select: vi.fn(() =>
				chainSelectRows([{ targetThoughtId: 't2', relationType: 'related_to' }])
			),
			insert
		});

		await expect(syncThoughtNeighborLinks('u1', 't1')).resolves.toBe(1);
		expect(insert).toHaveBeenCalled();
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
		getDbMock.mockReturnValue({
			select: vi.fn(() => chainSelectRows([])),
			insert: vi.fn()
		});

		await rebuildEntityTopThoughtsForThought('u1', 't1');
		expect(getDbMock).toHaveBeenCalledTimes(1);
	});

	it('rebuildEntityTopThoughtsForEntities upserts ranked thought ids', async () => {
		const insert = vi.fn(() => ({
			onConflictDoUpdate: vi.fn(async () => undefined)
		}));
		getDbMock.mockReturnValue({
			select: vi.fn(() =>
				chainSelectRows([
					{
						thoughtId: 't1',
						salience: 0.9,
						createdAt: new Date('2026-06-01T00:00:00.000Z'),
						thoughtSalience: 1.2
					}
				])
			),
			insert
		});

		await rebuildEntityTopThoughtsForEntities('u1', ['e1']);
		expect(insert).toHaveBeenCalledWith(
			expect.objectContaining({
				values: expect.objectContaining({
					entityId: 'e1',
					thoughtIds: ['t1']
				})
			})
		);
	});

	it('materializeRetrievalLinksForThought runs all sync steps', async () => {
		const insert = vi.fn(async () => undefined);
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
			select: vi.fn(() => chainSelectRows([])),
			insert
		});

		await materializeRetrievalLinksForThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello world'
		});

		expect(getDbMock).toHaveBeenCalled();
	});

	it('backfillRetrievalLinksForUser processes all thoughts and entities', async () => {
		const insert = vi.fn(() => ({
			onConflictDoUpdate: vi.fn(async () => undefined)
		}));
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
			select: vi.fn(() =>
				chainSelectRows([
					{ id: 't1', normalizedText: 'one' },
					{ entityId: 'e1' },
					{ entityId: 'e1' }
				])
			),
			insert
		});

		const result = await backfillRetrievalLinksForUser('u1');
		expect(result.thoughts).toBe(1);
		expect(result.entities).toBe(1);
	});
});
