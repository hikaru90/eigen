import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listProjectsForUser } from './project-list';

const { getDbMock, decryptTenantValueMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	decryptTenantValueMock: vi.fn(async () => 'next action text')
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	decryptTenantValue: decryptTenantValueMock
}));

function makeAwaitableChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		innerJoin: vi.fn(() => chain),
		leftJoin: vi.fn(() => chain),
		where: vi.fn(() => chain),
		limit: vi.fn(async () => rows),
		then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
			return Promise.resolve(rows).then(onFulfilled, onRejected);
		}
	};
	return chain;
}

describe('listProjectsForUser', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sorts active projects without next action first', async () => {
		getDbMock.mockReturnValue({
			select: vi
				.fn()
				.mockReturnValueOnce(
					makeAwaitableChain([
						{
							entityId: 'p-has',
							label: 'Beta',
							status: 'active',
							nextActionThoughtId: null
						},
						{
							entityId: 'p-missing',
							label: 'Alpha',
							status: 'active',
							nextActionThoughtId: null
						}
					])
				)
				.mockReturnValueOnce(makeAwaitableChain([]))
				.mockReturnValueOnce(makeAwaitableChain([]))
				.mockReturnValueOnce(makeAwaitableChain([]))
		});

		const projects = await listProjectsForUser('u1');
		expect(projects[0]?.entityId).toBe('p-missing');
		expect(projects[1]?.entityId).toBe('p-has');
	});
});
