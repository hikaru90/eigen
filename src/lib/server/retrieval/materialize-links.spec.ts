import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	backfillRetrievalLinksForUser,
	confidenceToSalience,
	materializeRetrievalLinksForThought,
	rebuildEntityTopThoughtsForEntities,
	rebuildEntityTopThoughtsForThought,
	syncThoughtEntityLinks,
	syncThoughtNeighborLinks,
	syncThoughtRerankSnippet,
	ThoughtEntityLinkIntegrityError
} from '$lib/server/retrieval/materialize-links';

type ManualRow = { entityId: string };
type LogRow = { entityId: string | null; confidence: string };
type ValidEntityRow = { id: string };

const state = vi.hoisted(() => ({
	deleteCalls: 0,
	insertCalls: 0,
	insertPayload: null as unknown,
	transactionFailed: false
}));

/** Transaction mock with ordered select responses. */
function createDbMock(selectQueue: Array<() => unknown>) {
	let selectIndex = 0;
	const tx = {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(async () => {
					const fn = selectQueue[selectIndex];
					selectIndex += 1;
					return fn ? fn() : [];
				})
			}))
		})),
		delete: vi.fn(() => ({
			where: vi.fn(async () => {
				state.deleteCalls += 1;
			})
		})),
		insert: vi.fn(() => ({
			values: vi.fn(async (payload: unknown) => {
				state.insertCalls += 1;
				state.insertPayload = payload;
				if (state.transactionFailed) {
					throw new Error('insert failed');
				}
			})
		}))
	};

	return {
		transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx))
	};
}

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(() => createDbMock([]))
}));

import { getDb } from '$lib/server/db';

function setupSelectQueue(manual: ManualRow[], logs: LogRow[], valid: ValidEntityRow[]) {
	state.deleteCalls = 0;
	state.insertCalls = 0;
	state.insertPayload = null;
	state.transactionFailed = false;
	vi.mocked(getDb).mockReturnValue(
		createDbMock([() => manual, () => logs, () => valid]) as unknown as ReturnType<typeof getDb>
	);
}

describe('confidenceToSalience', () => {
	it('maps legacy categorical confidence', () => {
		expect(confidenceToSalience('high')).toBe(1);
		expect(confidenceToSalience('medium')).toBe(0.7);
		expect(confidenceToSalience('low')).toBe(0.4);
	});

	it('maps numeric confidence from entity_resolution_log', () => {
		expect(confidenceToSalience('0.9000')).toBe(0.9);
		expect(confidenceToSalience('0.4000')).toBe(0.4);
	});

	it('clamps out-of-range numeric confidence', () => {
		expect(confidenceToSalience('1.5')).toBe(1);
		expect(confidenceToSalience('-0.2')).toBe(0);
	});
});

describe('syncThoughtEntityLinks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('deletes only ingest-sourced links before rebuild', async () => {
		setupSelectQueue([], [{ entityId: 'e1', confidence: 'high' }], [{ id: 'e1' }]);
		await syncThoughtEntityLinks('u1', 't1');
		expect(state.deleteCalls).toBe(1);
	});

	it('reinserts ingest links with source=ingest', async () => {
		setupSelectQueue([], [{ entityId: 'e1', confidence: 'high' }], [{ id: 'e1' }]);
		await syncThoughtEntityLinks('u1', 't1');
		expect(state.insertPayload).toEqual([
			expect.objectContaining({
				userId: 'u1',
				thoughtId: 't1',
				entityId: 'e1',
				source: 'ingest',
				salience: 1
			})
		]);
	});

	it('preserves manual GTD links and skips conflicting ingest insert', async () => {
		setupSelectQueue(
			[{ entityId: 'e1' }],
			[{ entityId: 'e1', confidence: '0.4000' }],
			[{ id: 'e1' }]
		);
		const count = await syncThoughtEntityLinks('u1', 't1');
		expect(count).toBe(0);
		expect(state.insertCalls).toBe(0);
	});

	it('uses max salience for duplicate log rows', async () => {
		setupSelectQueue(
			[],
			[
				{ entityId: 'e1', confidence: '0.4000' },
				{ entityId: 'e1', confidence: '0.9000' }
			],
			[{ id: 'e1' }]
		);
		await syncThoughtEntityLinks('u1', 't1');
		expect(state.insertPayload).toEqual([
			expect.objectContaining({ entityId: 'e1', salience: 0.9 })
		]);
	});

	it('throws on stale canonical entity references', async () => {
		setupSelectQueue([], [{ entityId: 'missing', confidence: 'high' }], []);
		await expect(syncThoughtEntityLinks('u1', 't1')).rejects.toBeInstanceOf(
			ThoughtEntityLinkIntegrityError
		);
	});

	it('rolls back when insert fails (transaction boundary)', async () => {
		setupSelectQueue([], [{ entityId: 'e1', confidence: 'high' }], [{ id: 'e1' }]);
		state.transactionFailed = true;
		await expect(syncThoughtEntityLinks('u1', 't1')).rejects.toThrow('insert failed');
	});

	it('returns 0 when resolution logs are empty', async () => {
		setupSelectQueue([], [], []);
		await expect(syncThoughtEntityLinks('u1', 't1')).resolves.toBe(0);
		expect(state.insertCalls).toBe(0);
	});

	it('falls back to 0.4 salience for unknown confidence tokens', () => {
		expect(confidenceToSalience('weird')).toBe(0.4);
	});
});

describe('syncThoughtNeighborLinks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 0 when there are no relations', async () => {
		const deleteWhere = vi.fn(async () => undefined);
		const selectWhere = vi.fn(async () => []);
		vi.mocked(getDb).mockReturnValue({
			delete: vi.fn(() => ({ where: deleteWhere })),
			select: vi.fn(() => ({
				from: vi.fn(() => ({ where: selectWhere }))
			})),
			insert: vi.fn()
		} as unknown as ReturnType<typeof getDb>);

		await expect(syncThoughtNeighborLinks('u1', 't1')).resolves.toBe(0);
	});

	it('rebuilds neighbor rows from thought_relation', async () => {
		const insertValues = vi.fn(async () => undefined);
		vi.mocked(getDb).mockReturnValue({
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{ targetThoughtId: 't2', relationType: 'supports' }
					])
				}))
			})),
			insert: vi.fn(() => ({ values: insertValues }))
		} as unknown as ReturnType<typeof getDb>);

		await expect(syncThoughtNeighborLinks('u1', 't1')).resolves.toBe(1);
		expect(insertValues).toHaveBeenCalledWith([
			expect.objectContaining({
				userId: 'u1',
				thoughtId: 't1',
				neighborId: 't2',
				relationType: 'supports',
				weight: 1
			})
		]);
	});
});

describe('syncThoughtRerankSnippet', () => {
	it('writes a truncated rerank snippet', async () => {
		const setMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
		vi.mocked(getDb).mockReturnValue({
			update: vi.fn(() => ({ set: setMock }))
		} as unknown as ReturnType<typeof getDb>);

		await syncThoughtRerankSnippet('u1', 't1', `  ${'a'.repeat(400)}  `);
		expect(setMock).toHaveBeenCalledWith({
			rerankSnippet: 'a'.repeat(300)
		});
	});
});

describe('rebuildEntityTopThoughts*', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rebuildEntityTopThoughtsForThought no-ops without entity links', async () => {
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(async () => [])
			}))
		}));
		vi.mocked(getDb).mockReturnValue({ select } as unknown as ReturnType<typeof getDb>);

		await rebuildEntityTopThoughtsForThought('u1', 't1');
		expect(select).toHaveBeenCalled();
	});

	it('rebuildEntityTopThoughtsForEntities no-ops on empty ids', async () => {
		await rebuildEntityTopThoughtsForEntities('u1', []);
		expect(getDb).not.toHaveBeenCalled();
	});

	it('inserts ranked entity_top_thoughts rows', async () => {
		const onConflictDoUpdate = vi.fn(async () => undefined);
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values }));
		const createdAt = new Date(Date.now() - 86400000);
		vi.mocked(getDb).mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [{ entityId: 'e1' }]),
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(async () => [
									{
										thoughtId: 't1',
										salience: 1,
										createdAt,
										thoughtSalience: 0.5
									},
									{
										thoughtId: 't2',
										salience: 0.4,
										createdAt: null,
										thoughtSalience: 0.2
									}
								])
							}))
						}))
					}))
				}))
			})),
			insert
		} as unknown as ReturnType<typeof getDb>);

		await rebuildEntityTopThoughtsForThought('u1', 't1');
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				entityId: 'e1',
				userId: 'u1',
				thoughtIds: ['t1', 't2']
			})
		);
		expect(onConflictDoUpdate).toHaveBeenCalled();
	});
});

describe('materializeRetrievalLinksForThought / backfill', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs the full materialization pass', async () => {
		const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
		const deleteWhere = vi.fn(async () => undefined);
		const insertValues = vi.fn(async () => undefined);
		vi.mocked(getDb).mockReturnValue({
			update: vi.fn(() => ({ set: updateSet })),
			transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
				fn({
					select: vi.fn(() => ({
						from: vi.fn(() => ({
							where: vi.fn(async () => [])
						}))
					})),
					delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
					insert: vi.fn()
				})
			),
			delete: vi.fn(() => ({ where: deleteWhere })),
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [])
				}))
			})),
			insert: vi.fn(() => ({ values: insertValues }))
		} as unknown as ReturnType<typeof getDb>);

		await materializeRetrievalLinksForThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello'
		});
		expect(updateSet).toHaveBeenCalled();
		expect(deleteWhere).toHaveBeenCalled();
	});

	it('backfills thoughts and unique entities', async () => {
		const updateSet = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }));
		let selectCall = 0;
		vi.mocked(getDb).mockReturnValue({
			update: updateSet,
			transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
				fn({
					select: vi.fn(() => ({
						from: vi.fn(() => ({
							where: vi.fn(async () => [])
						}))
					})),
					delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
					insert: vi.fn()
				})
			),
			delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			select: vi.fn(() => {
				selectCall += 1;
				return {
					from: vi.fn(() => ({
						where: vi.fn(async () => {
							if (selectCall === 1) {
								return [{ id: 't1', normalizedText: '  one  two  ' }];
							}
							if (selectCall === 2) {
								return []; // entity links for thought during rebuildEntityTopThoughtsForThought
							}
							return [{ entityId: 'e1' }, { entityId: 'e1' }, { entityId: 'e2' }];
						}),
						innerJoin: vi.fn(() => ({
							where: vi.fn(() => ({
								orderBy: vi.fn(() => ({
									limit: vi.fn(async () => [])
								}))
							}))
						}))
					}))
				};
			}),
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflictDoUpdate: vi.fn(async () => undefined)
				}))
			}))
		} as unknown as ReturnType<typeof getDb>);

		const result = await backfillRetrievalLinksForUser('u1');
		expect(result.thoughts).toBe(1);
		expect(result.entities).toBe(2);
		expect(result.samples[0]).toMatchObject({
			kind: 'thought',
			id: 't1',
			label: 'one two'
		});
		expect(result.sampleTotal).toBe(1);
	});
});
