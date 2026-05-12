import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));

function chain(overrides: Record<string, unknown> = {}) {
	const node: Record<string, ReturnType<typeof vi.fn>> = {};
	node.orderBy = vi.fn(() => node);
	node.limit = vi.fn(async () => []);
	node.then = vi.fn(async (resolve: (v: unknown) => unknown) => resolve([{}]));
	node.where = vi.fn(() => node);
	node.from = vi.fn(() => node);
	node.select = vi.fn(() => node);
	Object.assign(node, overrides);
	return node;
}

describe('activity page server', () => {
	it('redirects unauthenticated user', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});

	it('returns EuRouter gateway rows, groups, and summed totals', async () => {
		const rows = [
			{
				id: 'call-1',
				userId: 'u1',
				provider: 'eurouter',
				operation: 'llm.chat.success(attempt=1)',
				baseCostUsd: '1.000000',
				markupUsd: '0.200000',
				totalCostUsd: '1.200000',
				markupRate: '0.200000',
				groupId: null,
				durationMs: 342,
				createdAt: new Date('2026-01-01T00:00:00Z')
			}
		];
		const db = chain({
			limit: vi.fn(async () => rows),
			then: vi.fn(async (resolve: (v: unknown) => unknown) =>
				resolve([{ baseCostUsd: '1.000000', markupUsd: '0.200000', totalCostUsd: '1.200000' }])
			)
		});
		getDbMock.mockReturnValue(db);

		const data = await load({
			locals: { user: { id: 'u1', email: 'a@b.c' } },
			url: new URL('http://localhost/activity')
		} as never);
		expect(data.calls).toEqual(rows);
		expect(data.groups).toEqual([{ groupId: null, groupStart: rows[0].createdAt, callCount: 1 }]);
		expect(data.totals).toEqual({
			baseCostUsd: '1.000000',
			markupUsd: '0.200000',
			totalCostUsd: '1.200000'
		});
		expect(data.overallTotals).toEqual({
			baseCostUsd: '1.000000',
			markupUsd: '0.200000',
			totalCostUsd: '1.200000'
		});
	});

	it('groups related calls by groupId', async () => {
		const rows = [
			{
				id: 'c2',
				userId: 'u1',
				provider: 'agent',
				operation: 'tool_call.retrieve_thoughts',
				baseCostUsd: '0.000000',
				markupUsd: '0.000000',
				totalCostUsd: '0.000000',
				markupRate: '0.200000',
				groupId: 'g1',
				durationMs: 200,
				createdAt: new Date('2026-01-02T00:00:02Z')
			},
			{
				id: 'c1',
				userId: 'u1',
				provider: 'eurouter',
				operation: 'llm.chat.success(attempt=1)',
				baseCostUsd: '1.000000',
				markupUsd: '0.200000',
				totalCostUsd: '1.200000',
				markupRate: '0.200000',
				groupId: 'g1',
				durationMs: 500,
				createdAt: new Date('2026-01-02T00:00:01Z')
			}
		];
		const db = chain({
			limit: vi.fn(async () => rows),
			then: vi.fn(async (resolve: (v: unknown) => unknown) =>
				resolve([{ baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' }])
			)
		});
		getDbMock.mockReturnValue(db);

		const data = await load({
			locals: { user: { id: 'u1', email: 'a@b.c' } },
			url: new URL('http://localhost/activity')
		} as never);
		expect(data.groups).toEqual([{ groupId: 'g1', groupStart: rows[1].createdAt, callCount: 2 }]);
	});

	it('passes through from/to query params', async () => {
		const db = chain({
			limit: vi.fn(async () => []),
			then: vi.fn(async (resolve: (v: unknown) => unknown) =>
				resolve([{ baseCostUsd: '0', markupUsd: '0', totalCostUsd: '0' }])
			)
		});
		getDbMock.mockReturnValue(db);

		const data = await load({
			locals: { user: { id: 'u1', email: 'a@b.c' } },
			url: new URL('http://localhost/activity?from=2026-01-01&to=2026-01-31')
		} as never);
		expect(data.from).toBe('2026-01-01');
		expect(data.to).toBe('2026-01-31');
		expect(data.overallTotals).toBeDefined();
	});

	it('skips overall totals for agent filter', async () => {
		const db = chain({
			limit: vi.fn(async () => [])
		});
		getDbMock.mockReturnValue(db);

		const data = await load({
			locals: { user: { id: 'u1', email: 'a@b.c' } },
			url: new URL('http://localhost/activity?type=agent')
		} as never);
		expect(data.overallTotals).toEqual({ baseCostUsd: '0', markupUsd: '0', totalCostUsd: '0' });
	});
});
