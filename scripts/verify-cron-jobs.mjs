/**
 * Fail fast when required pg_cron jobs are missing after bootstrap.
 */
import './load-env.mjs';
import postgres from 'postgres';

const REQUIRED_JOBS = [
	'eigen-event-reminders',
	'eigen-job-queue-tick',
	'eigen-sleep-consolidation'
];

function getAdminDatabaseUrl() {
	const raw = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim();
	if (!raw) {
		throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required for verify-cron-jobs.mjs');
	}
	return raw;
}

function isProductionRuntime() {
	return process.env.NODE_ENV === 'production';
}

if (!isProductionRuntime()) {
	console.log('[eigen] skipping cron verification (NODE_ENV is not production)');
	process.exit(0);
}

const sql = postgres(getAdminDatabaseUrl(), { max: 1 });

try {
	const rows = await sql<Array<{ jobname: string; active: boolean }>>`
		SELECT jobname, active
		FROM cron.job
		WHERE jobname = ANY(${REQUIRED_JOBS})
	`;

	const found = new Map(rows.map((row) => [row.jobname, row.active]));
	const missing = REQUIRED_JOBS.filter((name) => !found.has(name));
	const inactive = REQUIRED_JOBS.filter((name) => found.get(name) === false);

	if (missing.length > 0 || inactive.length > 0) {
		throw new Error(
			`pg_cron jobs incomplete (missing: ${missing.join(', ') || 'none'}; inactive: ${inactive.join(', ') || 'none'})`
		);
	}

	console.log('[eigen] verified pg_cron jobs', {
		jobs: REQUIRED_JOBS.map((name) => ({ name, active: found.get(name) }))
	});
} finally {
	await sql.end();
}
