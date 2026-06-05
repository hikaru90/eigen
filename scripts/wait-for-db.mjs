/**
 * Poll until Postgres accepts connections (used after `docker compose up`).
 */
import './load-env.mjs';
import postgres from 'postgres';
import { getDatabaseUrl } from './db-urls.mjs';

const maxAttempts = 30;
const delayMs = 1000;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
	let sql;
	try {
		sql = postgres(getDatabaseUrl(), { max: 1, connect_timeout: 3 });
		await sql`SELECT 1`;
		console.log('[eigen] Database is ready.');
		await sql.end();
		process.exit(0);
	} catch (err) {
		await sql?.end().catch(() => {});
		if (attempt === maxAttempts) {
			console.error('[eigen] Database not ready after', maxAttempts, 'attempts:', err);
			process.exit(1);
		}
		console.log(`[eigen] Waiting for database (${attempt}/${maxAttempts})...`);
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
}
