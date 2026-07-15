import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	confidenceToSalience,
	syncThoughtEntityLinks,
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
});
