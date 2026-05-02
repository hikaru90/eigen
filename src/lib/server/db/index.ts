import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const runtimeDatabaseUrl = (() => {
	try {
		const url = new URL(env.DATABASE_URL);
		// `uselibpqcompat` is a pg-connection-string flag used by drizzle-kit's pg driver.
		// postgres.js forwards unknown params to PostgreSQL, which causes a fatal error.
		url.searchParams.delete('uselibpqcompat');
		return url.toString();
	} catch {
		return env.DATABASE_URL;
	}
})();

const client = postgres(runtimeDatabaseUrl);

export const db = drizzle(client, { schema });
