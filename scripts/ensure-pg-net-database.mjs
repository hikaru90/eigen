/**
 * Verify pg_net worker database matches the app database (cron.database_name / DATABASE URL).
 * pg_net.database_name is a postmaster GUC — fix via docker-compose `postgres -c pg_net.database_name=eigen`
 * and restart Postgres. Misconfiguration leaves net.http_request_queue stuck with zero responses.
 */
import './load-env.mjs';
import postgres from 'postgres';
import { databaseNameFromUrl } from './pg-cron-schedule.mjs';

function getAdminDatabaseUrl() {
	const raw = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim();
	if (!raw) {
		throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required for ensure-pg-net-database.mjs');
	}
	return raw;
}

const databaseUrl = getAdminDatabaseUrl();
const expectedDatabase = databaseNameFromUrl(databaseUrl);
const sql = postgres(databaseUrl, { max: 1 });

try {
	const settingsRows = await sql`
		SELECT name, setting
		FROM pg_settings
		WHERE name IN ('pg_net.database_name', 'cron.database_name')
	`;
	const pgNetDb = settingsRows.find((row) => row.name === 'pg_net.database_name')?.setting ?? null;
	const cronDb = settingsRows.find((row) => row.name === 'cron.database_name')?.setting ?? null;
	const targetDb = cronDb ?? expectedDatabase;

	if (pgNetDb === targetDb) {
		const [queueRow] = await sql`SELECT count(*)::text AS count FROM net.http_request_queue`;
		const [responseRow] = await sql`SELECT count(*)::text AS count FROM net._http_response`;
		console.log('[eigen] pg_net database OK', {
			pgNetDatabase: pgNetDb,
			queueDepth: Number(queueRow?.count ?? 0),
			responseCount: Number(responseRow?.count ?? 0)
		});
		process.exit(0);
	}

	console.error('[eigen] pg_net.database_name mismatch — scheduled HTTP callbacks will not run', {
		pgNetDatabase: pgNetDb,
		expectedDatabase: targetDb,
		fix: 'Set postgres -c pg_net.database_name=' + targetDb + ' and restart the database container'
	});
	process.exit(1);
} finally {
	await sql.end();
}
