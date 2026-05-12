import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getRuntimeDatabaseUrl } from './runtime-url';
import type { AppDatabase } from './context';

export { getDb, appDbAsyncLocal } from './context';
export type { AppDatabase } from './context';

/**
 * App-facing Postgres pool. Use `getDb()` inside request handlers (RLS session var is set in hooks).
 *
 * `max` must be `1`: Drizzle `db.transaction()` issues `BEGIN` via `client.begin()` / `unsafe('begin')`.
 * postgres.js rejects `BEGIN` on pooled connections when `max > 1` unless the connection is in the
 * internal state produced by `sql.begin()`'s `onexecute` path (`UNSAFE_TRANSACTION`).
 * Per-request RLS uses `reserve()` + a patched `begin` on the reserved handle; keeping `max: 1`
 * matches postgres.js's allowed modes and avoids that failure.
 */
export const appSql = postgres(getRuntimeDatabaseUrl(), { max: 1 });

export async function closeAppDbPool(): Promise<void> {
	await appSql.end({ timeout: 1 });
}

type ReservedSql = postgres.Sql;

/**
 * `postgres.reserve()` returns an inner `Sql` handle without `begin()` (unlike the pool root).
 * Drizzle's postgres-js session calls `client.begin()` for `db.transaction()`, so we attach a
 * `begin` that issues `BEGIN` / `COMMIT` / `ROLLBACK` on this reserved connection, plus
 * `savepoint` for nested Drizzle transactions.
 */
function attachReservedBeginIfMissing(reserved: ReservedSql): void {
	const extended = reserved as ReservedSql & {
		begin?: unknown;
		savepoint?: unknown;
	};
	if (typeof extended.begin === 'function') return;

	extended.begin = async (
		optionsOrFn?: string | ((sql: ReservedSql) => unknown | Promise<unknown>),
		maybeFn?: (sql: ReservedSql) => unknown | Promise<unknown>
	): Promise<unknown> => {
		let options = '';
		let fn: (sql: ReservedSql) => unknown | Promise<unknown>;
		if (typeof optionsOrFn === 'function') {
			fn = optionsOrFn;
		} else {
			options = optionsOrFn ?? '';
			if (typeof maybeFn !== 'function') {
				throw new TypeError('begin(options, fn) requires a callback');
			}
			fn = maybeFn;
		}

		const beginSql =
			options.trim().length === 0 ? 'begin' : `begin ${options.replace(/[^a-z ]/gi, '')}`;

		await reserved.unsafe(beginSql);

		let savepoints = 0;

		const savepoint = async (
			nameOrFn: string | ((sql: ReservedSql) => unknown | Promise<unknown>),
			maybeSpFn?: (sql: ReservedSql) => unknown | Promise<unknown>
		): Promise<unknown> => {
			let spFn: (sql: ReservedSql) => unknown | Promise<unknown>;
			let name: string | undefined;
			if (typeof maybeSpFn === 'function') {
				name = String(nameOrFn);
				spFn = maybeSpFn;
			} else if (typeof nameOrFn === 'function') {
				spFn = nameOrFn;
				name = undefined;
			} else {
				throw new TypeError('savepoint requires a callback');
			}

			const sp = 's' + savepoints++ + (name ? '_' + name : '');
			await reserved`savepoint ${reserved(sp)}`;
			try {
				const out = await Promise.resolve(spFn(reserved));
				await reserved`release savepoint ${reserved(sp)}`;
				return out;
			} catch (err) {
				await reserved`rollback to savepoint ${reserved(sp)}`;
				throw err;
			}
		};

		extended.savepoint = savepoint;

		try {
			const result = await Promise.resolve(fn(reserved));
			await reserved.unsafe('commit');
			return result;
		} catch (err) {
			await reserved.unsafe('rollback');
			throw err;
		} finally {
			delete extended.savepoint;
		}
	};
}

/**
 * `postgres.js` connections from `reserve()` are `Sql` handles without `options`.
 * Drizzle's postgres-js driver expects `client.options` (see drizzle `construct`), so we attach the pool's options.
 */
export function createScopedDrizzle(reserved: postgres.Sql): AppDatabase {
	Object.assign(reserved as postgres.Sql & { options: (typeof appSql)['options'] }, {
		options: appSql.options
	});
	attachReservedBeginIfMissing(reserved);
	return drizzle(reserved, { schema });
}
