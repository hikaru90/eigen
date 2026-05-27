/**
 * Schedule nightly consolidation via pg_cron + pg_net (HTTP POST to app).
 *
 * Requires DATABASE_ADMIN_URL, ADMIN_CONSOLIDATION_KEY, and a running Postgres
 * with pg_cron + pg_net extensions (see Dockerfile.postgres).
 *
 * Usage: node scripts/ensure-sleep-cron.mjs
 */
import './load-env.mjs';
import postgres from 'postgres';

const JOB_NAME = 'eigen-sleep-consolidation';

function getAdminDatabaseUrl() {
	const raw = process.env.DATABASE_ADMIN_URL?.trim();
	if (!raw) {
		throw new Error('DATABASE_ADMIN_URL is required for ensure-sleep-cron.mjs');
	}
	return raw;
}

function requireAdminKey() {
	const key = process.env.ADMIN_CONSOLIDATION_KEY?.trim();
	if (!key) {
		throw new Error('ADMIN_CONSOLIDATION_KEY is required to schedule sleep consolidation');
	}
	return key;
}

function getInternalUrl() {
	const raw = process.env.CONSOLIDATION_INTERNAL_URL?.trim();
	if (!raw) {
		throw new Error('CONSOLIDATION_INTERNAL_URL is required (e.g. http://app:3000)');
	}
	return raw.replace(/\/$/, '');
}

function getSchedule() {
	return process.env.CONSOLIDATION_CRON_SCHEDULE?.trim() || '0 2 * * *';
}

function getTimezone() {
	return process.env.CONSOLIDATION_CRON_TZ?.trim() || 'UTC';
}

const sql = postgres(getAdminDatabaseUrl(), { max: 1 });

try {
	const adminKey = requireAdminKey();
	const internalUrl = getInternalUrl();
	const schedule = getSchedule();
	const timezone = getTimezone();
	const consolidateUrl = `${internalUrl}/api/admin/consolidate`;

	await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_cron`);
	await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_net`);

	// Remove prior job with the same name (pg_cron 1.4+ jobname column).
	const existing = await sql`
		SELECT jobid FROM cron.job WHERE jobname = ${JOB_NAME}
	`;
	for (const row of existing) {
		await sql`SELECT cron.unschedule(${row.jobid})`;
	}

	const escapedKey = adminKey.replace(/'/g, "''");
	const escapedUrl = consolidateUrl.replace(/'/g, "''");

	const command = `
		SELECT net.http_post(
			url := '${escapedUrl}',
			headers := jsonb_build_object(
				'Content-Type', 'application/json',
				'X-Admin-Key', '${escapedKey}'
			),
			body := '{}'::jsonb
		) AS request_id;
	`.trim();

	// schedule_in_timezone(job_name, schedule, timezone, command) — pg_cron 1.4+
	await sql.unsafe(`
		SELECT cron.schedule_in_timezone(
			'${JOB_NAME.replace(/'/g, "''")}',
			'${schedule.replace(/'/g, "''")}',
			'${timezone.replace(/'/g, "''")}',
			$$${command}$$
		);
	`);

	console.log(
		`[eigen] Scheduled "${JOB_NAME}" at "${schedule}" (${timezone}) → POST ${consolidateUrl}`
	);
} finally {
	await sql.end();
}
