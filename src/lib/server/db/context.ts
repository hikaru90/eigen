import { AsyncLocalStorage } from 'node:async_hooks';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export const appDbAsyncLocal = new AsyncLocalStorage<AppDatabase>();

export function getDb(): AppDatabase {
	const db = appDbAsyncLocal.getStore();
	if (!db) {
		throw new Error('getDb() was called outside an active request (missing app DB context)');
	}
	return db;
}
