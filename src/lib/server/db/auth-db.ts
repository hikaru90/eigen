import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as authSchema from './auth.schema';
import { getRuntimeDatabaseUrl } from './runtime-url';

/** Dedicated pool for Better Auth so it never shares connections with RLS-scoped app queries. */
export const authSql = postgres(getRuntimeDatabaseUrl(), { max: 5 });

export const authDb = drizzle(authSql, { schema: authSchema });

export async function closeAuthDbPool(): Promise<void> {
	await authSql.end({ timeout: 1 });
}
