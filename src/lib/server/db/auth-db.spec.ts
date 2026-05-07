import { describe, expect, it, vi } from 'vitest';

const { endMock } = vi.hoisted(() => ({
	endMock: vi.fn(async () => undefined)
}));

vi.mock('postgres', () => ({
	default: vi.fn(() => ({
		end: endMock
	}))
}));

vi.mock('drizzle-orm/postgres-js', () => ({
	drizzle: vi.fn(() => ({ mocked: true }))
}));

describe('db/auth-db', () => {
	it('closeAuthDbPool closes auth pool', async () => {
		const { closeAuthDbPool } = await import('./auth-db');
		await closeAuthDbPool();
		expect(endMock).toHaveBeenCalled();
	});
});
