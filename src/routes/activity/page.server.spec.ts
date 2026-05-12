import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));

describe('activity page server', () => {
	it('redirects unauthenticated user', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});

	it('returns EuRouter gateway rows and summed totals', async () => {
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
				createdAt: new Date('2026-01-01T00:00:00Z')
			}
		];
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(async () => rows)
						}))
					}))
				}))
			}))
		});

		const data = await load({ locals: { user: { id: 'u1', email: 'a@b.c' } } } as never);
		expect(data.calls).toEqual(rows);
		expect(data.totals).toEqual({
			baseCostUsd: '1.000000',
			markupUsd: '0.200000',
			totalCostUsd: '1.200000'
		});
	});
});
