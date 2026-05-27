import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getRuntimeDatabaseUrl } from './runtime-url';
import { appDbAsyncLocal, type AppDatabase } from './context';
import { activateTenantDbSession, deactivateTenantDbSession } from './tenant-session';

export { getDb, appDbAsyncLocal } from './context';
export type { AppDatabase } from './context';
export { activateTenantDbSession, deactivateTenantDbSession, appDbRole } from './tenant-session';

/**
 * Run `fn` with RLS scoped to `userId` (eval metadata tables, etc.).
 */
export async function withDbUser<T>(userId: string, fn: (db: AppDatabase) => Promise<T>): Promise<T> {
	const reserved = await appSql.reserve();
	try {
		await activateTenantDbSession(reserved, userId);
		const scopedDb = createScopedDrizzle(reserved);
		return await appDbAsyncLocal.run(scopedDb, () => fn(scopedDb));
	} finally {
		await deactivateTenantDbSession(reserved).catch(() => {});
		await reserved.release();
	}
}

/**
 * App-facing Postgres pool. Use `getDb()` inside request handlers (RLS session var is set in hooks).
 *
 * Pool connects with DATABASE_URL (often the DB owner / superuser for migrations and Studio).
 * Each reserved connection calls SET ROLE to the non-superuser APP_DB_ROLE (default eigen_app)
 * before set_config('app.current_user_id', …) so row-level security applies even when the pool
 * user is a superuser.
 *
 * Each request calls `appSql.reserve()` in hooks.server to obtain a dedicated connection for the
 * lifetime of that request. `attachReservedBeginIfMissing` patches a `begin()` method onto every
 * reserved handle so that Drizzle `db.transaction()` works correctly (it calls `client.begin()`
 * internally). This approach is safe with any `max` value — reserved connections are exclusively
 * held and never shared between concurrent requests.
 *
 * Pool size: controlled by `DB_POOL_MAX` env var, defaulting to 10. A capture pipeline holds its
 * connection for the full request duration (including LLM calls), so you need at least as many
 * connections as you expect concurrent in-flight captures plus background requests.
 */
function poolMax(): number {
	const raw = (typeof process !== 'undefined' ? process.env.DB_POOL_MAX : undefined) ?? '';
	if (!raw.trim()) return 10;
	const parsed = Number(raw.trim());
	if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
		throw new Error(`DB_POOL_MAX must be a positive integer, got: ${raw}`);
	}
	return parsed;
}

export const appSql = postgres(getRuntimeDatabaseUrl(), { max: poolMax(), idle_timeout: 30 });

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
