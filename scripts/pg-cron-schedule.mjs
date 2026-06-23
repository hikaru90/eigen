/**
 * pg_cron 1.6-compatible HTTP job scheduling (cron.schedule + DB cron.timezone).
 * pg_cron 1.6 does not provide cron.schedule_in_timezone().
 */

/** @param {string} value */
export function escapePgLiteral(value) {
	return value.replace(/'/g, "''");
}

/**
 * @param {{ url: string; adminKey: string }} opts
 * @returns {string}
 */
export function buildHttpPostCommand({ url, adminKey }) {
	const escapedUrl = escapePgLiteral(url);
	const escapedKey = escapePgLiteral(adminKey);
	return `
		SELECT net.http_post(
			url := '${escapedUrl}',
			headers := jsonb_build_object(
				'Content-Type', 'application/json',
				'X-Admin-Key', '${escapedKey}'
			),
			body := '{}'::jsonb
		) AS request_id;
	`.trim();
}

/**
 * @param {{ jobName: string; schedule: string; command: string }} opts
 * @returns {string}
 */
export function buildScheduleSql({ jobName, schedule, command }) {
	return `
		SELECT cron.schedule(
			'${escapePgLiteral(jobName)}',
			'${escapePgLiteral(schedule)}',
			$$${command}$$
		);
	`.trim();
}

/**
 * @param {string} databaseName
 * @param {string} timezone
 * @returns {string}
 */
export function buildSetCronTimezoneSql(databaseName, timezone) {
	return `ALTER DATABASE "${databaseName.replace(/"/g, '""')}" SET cron.timezone TO '${escapePgLiteral(timezone)}'`;
}

/**
 * @param {string} databaseUrl
 * @returns {string}
 */
export function databaseNameFromUrl(databaseUrl) {
	const pathname = new URL(databaseUrl).pathname.replace(/^\//, '');
	if (!pathname) {
		throw new Error('DATABASE_ADMIN_URL must include a database name');
	}
	return decodeURIComponent(pathname);
}

/**
 * @param {import('postgres').Sql} sql
 * @param {{
 *   jobName: string;
 *   schedule: string;
 *   timezone: string;
 *   url: string;
 *   adminKey: string;
 *   databaseUrl: string;
 * }} opts
 */
export async function schedulePgCronHttpJob(sql, opts) {
	const { jobName, schedule, timezone, url, adminKey, databaseUrl } = opts;

	await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_cron`);
	await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_net`);

	const existing = await sql`
		SELECT jobid FROM cron.job WHERE jobname = ${jobName}
	`;
	for (const row of existing) {
		await sql`SELECT cron.unschedule(${row.jobid})`;
	}

	const databaseName = databaseNameFromUrl(databaseUrl);
	await sql.unsafe(buildSetCronTimezoneSql(databaseName, timezone));

	const command = buildHttpPostCommand({ url, adminKey });
	await sql.unsafe(buildScheduleSql({ jobName, schedule, command }));
}
