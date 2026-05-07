import { describe, expect, it, vi } from 'vitest';

const { endMock, drizzleMock } = vi.hoisted(() => ({
	endMock: vi.fn(async () => undefined),
	drizzleMock: vi.fn(() => ({ mocked: true }))
}));

vi.mock('postgres', () => ({
	default: vi.fn(() => ({
		end: endMock,
		options: { host: 'localhost' }
	}))
}));

vi.mock('drizzle-orm/postgres-js', () => ({
	drizzle: drizzleMock
}));

describe('db/index', () => {
	it('closeAppDbPool closes postgres pool', async () => {
		const { closeAppDbPool } = await import('./index');
		await closeAppDbPool();
		expect(endMock).toHaveBeenCalled();
	});

	it('createScopedDrizzle attaches options and returns drizzle db', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = {} as never;
		const db = createScopedDrizzle(reserved);
		expect((reserved as { options?: unknown }).options).toBeDefined();
		expect(drizzleMock).toHaveBeenCalled();
		expect(db).toEqual({ mocked: true });
	});
});
