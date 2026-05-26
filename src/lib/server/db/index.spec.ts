import { describe, expect, it, vi } from 'vitest';

const { endMock, drizzleMock, reserveMock } = vi.hoisted(() => ({
	endMock: vi.fn(async () => undefined),
	drizzleMock: vi.fn(() => ({ mocked: true })),
	reserveMock: vi.fn()
}));

vi.mock('postgres', () => ({
	default: vi.fn(() => ({
		end: endMock,
		options: { host: 'localhost' },
		reserve: reserveMock
	}))
}));

vi.mock('drizzle-orm/postgres-js', () => ({
	drizzle: drizzleMock
}));

type ReservedMock = ((...args: unknown[]) => Promise<unknown>) & {
	unsafe: ReturnType<typeof vi.fn>;
	tagCalls: unknown[][];
};

/** Mimic the callable `postgres.js` `Sql` handle: tag-template + identifier + `.unsafe()`. */
function makeReservedMock(): ReservedMock {
	const tagCalls: unknown[][] = [];
	const reserved = ((...args: unknown[]) => {
		tagCalls.push(args);
		return Promise.resolve(undefined);
	}) as ReservedMock;
	reserved.unsafe = vi.fn(async () => undefined);
	reserved.tagCalls = tagCalls;
	return reserved;
}

describe('db/index', () => {
	it('withDbUser scopes the session user and releases the reserved connection', async () => {
		const release = vi.fn(async () => undefined);
		const reserved = Object.assign(vi.fn(async () => undefined), { release });
		reserveMock.mockResolvedValue(reserved);

		const { withDbUser } = await import('./index');
		const fn = vi.fn(async () => 'scoped');

		await expect(withDbUser('user-123', fn)).resolves.toBe('scoped');
		expect(reserved).toHaveBeenCalled();
		expect(release).toHaveBeenCalled();
		expect(fn).toHaveBeenCalled();
	});

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

	it('createScopedDrizzle leaves an existing begin alone', async () => {
		const { createScopedDrizzle } = await import('./index');
		const existingBegin = vi.fn();
		const reserved = Object.assign(makeReservedMock(), { begin: existingBegin });
		createScopedDrizzle(reserved as never);
		expect((reserved as { begin: unknown }).begin).toBe(existingBegin);
	});

	it('attached begin(fn) commits and returns the callback result', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (fn: (sql: unknown) => unknown) => Promise<unknown>;
		};
		const out = await extended.begin(async (sql) => {
			expect(sql).toBe(reserved);
			return 'ok';
		});
		expect(out).toBe('ok');
		expect(reserved.unsafe).toHaveBeenCalledWith('begin');
		expect(reserved.unsafe).toHaveBeenCalledWith('commit');
	});

	it('attached begin(options, fn) sanitizes options and commits', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (
				options: string,
				fn: (sql: unknown) => unknown
			) => Promise<unknown>;
		};
		await extended.begin('read only; drop tables', async () => 42);
		expect(reserved.unsafe).toHaveBeenCalledWith('begin read only drop tables');
		expect(reserved.unsafe).toHaveBeenCalledWith('commit');
	});

	it('attached begin(options, fn) throws when callback is missing', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (options: string) => Promise<unknown>;
		};
		await expect(extended.begin('read only')).rejects.toThrow(/requires a callback/);
	});

	it('attached begin rolls back when the callback throws', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (fn: (sql: unknown) => unknown) => Promise<unknown>;
		};
		await expect(
			extended.begin(async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		expect(reserved.unsafe).toHaveBeenCalledWith('rollback');
	});

	it('savepoint(fn) releases on success', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (fn: (sql: unknown) => unknown) => Promise<unknown>;
			savepoint?: (fn: (sql: unknown) => unknown) => Promise<unknown>;
		};

		const captured: { savepoint?: (fn: (sql: unknown) => unknown) => Promise<unknown> } = {};
		await extended.begin(async () => {
			captured.savepoint = extended.savepoint;
			return await extended.savepoint!(async () => 'inner');
		});
		expect(captured.savepoint).toBeTypeOf('function');
		expect(extended.savepoint).toBeUndefined();
		const tags = reserved.tagCalls.map((call) => (call[0] as string[])[0] ?? '').join(' | ');
		expect(tags).toContain('savepoint ');
		expect(tags).toContain('release savepoint ');
	});

	it('savepoint(name, fn) rolls back on error', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (fn: (sql: unknown) => unknown) => Promise<unknown>;
			savepoint?: (
				name: string,
				fn: (sql: unknown) => unknown
			) => Promise<unknown>;
		};

		await expect(
			extended.begin(async () => {
				await extended.savepoint!('s1', async () => {
					throw new Error('nope');
				});
			})
		).rejects.toThrow('nope');
		const tags = reserved.tagCalls.map((call) => (call[0] as string[])[0] ?? '').join(' | ');
		expect(tags).toContain('rollback to savepoint ');
	});

	it('savepoint throws when no callback is provided', async () => {
		const { createScopedDrizzle } = await import('./index');
		const reserved = makeReservedMock();
		createScopedDrizzle(reserved as never);
		const extended = reserved as ReservedMock & {
			begin: (fn: (sql: unknown) => unknown) => Promise<unknown>;
			savepoint?: (name?: unknown) => Promise<unknown>;
		};

		await expect(
			extended.begin(async () => {
				await extended.savepoint!('orphan');
			})
		).rejects.toThrow(/savepoint requires a callback/);
	});

	it('throws when DB_POOL_MAX is not a positive integer', async () => {
		const prev = process.env.DB_POOL_MAX;
		process.env.DB_POOL_MAX = 'not-a-number';
		vi.resetModules();
		await expect(import('./index')).rejects.toThrow(/DB_POOL_MAX must be a positive integer/);
		vi.resetModules();
		if (prev === undefined) delete process.env.DB_POOL_MAX;
		else process.env.DB_POOL_MAX = prev;
	});
});
