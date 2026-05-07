import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getRuntimeDatabaseUrl } from './runtime-url';
import type { AppDatabase } from './context';

export { getDb, appDbAsyncLocal } from './context';
export type { AppDatabase } from './context';

/** App-facing Postgres pool. Use `getDb()` inside request handlers (RLS session var is set in hooks). */
export const appSql = postgres(getRuntimeDatabaseUrl(), { max: 15 });

export async function closeAppDbPool(): Promise<void> {
	await appSql.end({ timeout: 1 });
}

/**
 * `postgres.js` connections from `reserve()` are `Sql` handles without `options`.
 * Drizzle's postgres-js driver expects `client.options` (see drizzle `construct`), so we attach the pool's options.
 */
export function createScopedDrizzle(reserved: postgres.Sql): AppDatabase {
	Object.assign(reserved as postgres.Sql & { options: (typeof appSql)['options'] }, {
		options: appSql.options
	});
	return drizzle(reserved, { schema });
}
