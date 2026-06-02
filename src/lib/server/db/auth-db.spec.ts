import { describe, expect, it, vi } from 'vitest';
import { closeAuthDbPool } from './auth-db';

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
		await closeAuthDbPool();
		expect(endMock).toHaveBeenCalled();
	});
});
