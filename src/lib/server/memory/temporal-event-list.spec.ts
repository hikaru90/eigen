import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	decryptTenantValue: vi.fn(async () => '{}')
}));

import { listTemporalEventsForUser } from './temporal-event-list';

function makeSelectChain(whereSpy: ReturnType<typeof vi.fn>, rows: unknown[] = []) {
	const limit = vi.fn(async () => rows);
	const orderBy = vi.fn(() => ({ limit }));
	const where = whereSpy.mockImplementation(() => ({
		orderBy,
		limit,
		then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
			return Promise.resolve(rows).then(onFulfilled, onRejected);
		}
	}));
	return {
		from: vi.fn(() => ({
			innerJoin: vi.fn(() => ({ where })),
			where
		}))
	};
}

describe('listTemporalEventsForUser author filter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('queries temporal events and task thoughts when author is user', async () => {
		const eventWhereSpy = vi.fn();
		const taskEventWhereSpy = vi.fn();
		const taskThoughtWhereSpy = vi.fn();
		const projectWhereSpy = vi.fn();
		let selectCall = 0;

		getDbMock.mockImplementation(() => ({
			select: vi.fn(() => {
				selectCall += 1;
				if (selectCall === 1) {
					return makeSelectChain(eventWhereSpy, []);
				}
				if (selectCall === 2) {
					return makeSelectChain(taskEventWhereSpy, []);
				}
				if (selectCall === 3) {
					return makeSelectChain(taskThoughtWhereSpy, []);
				}
				return makeSelectChain(projectWhereSpy, []);
			})
		}));

		await listTemporalEventsForUser({
			userId: 'u1',
			status: 'open',
			includeTasks: true,
			author: 'user'
		});

		expect(eventWhereSpy).toHaveBeenCalled();
		expect(taskEventWhereSpy).toHaveBeenCalled();
		expect(taskThoughtWhereSpy).toHaveBeenCalled();
	});

	it('queries without author constraint when author is omitted', async () => {
		const eventWhereSpy = vi.fn();
		const taskEventWhereSpy = vi.fn();
		const taskThoughtWhereSpy = vi.fn();
		let selectCall = 0;

		getDbMock.mockImplementation(() => ({
			select: vi.fn(() => {
				selectCall += 1;
				if (selectCall === 1) {
					return makeSelectChain(eventWhereSpy, []);
				}
				if (selectCall === 2) {
					return makeSelectChain(taskEventWhereSpy, []);
				}
				if (selectCall === 3) {
					return makeSelectChain(taskThoughtWhereSpy, []);
				}
				return makeSelectChain(vi.fn(), []);
			})
		}));

		await listTemporalEventsForUser({
			userId: 'u1',
			status: 'open',
			includeTasks: true
		});

		expect(eventWhereSpy).toHaveBeenCalled();
		expect(taskThoughtWhereSpy).toHaveBeenCalled();
	});
});
