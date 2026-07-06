/**
 * Production bootstrap: secrets → pg_cron schedule → verification in one Node process
 * so generated env vars are visible to child cron scripts on first container boot.
 */
import './load-env.mjs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDeploySecrets } from './ensure-deploy-secrets-lib.mjs';
import { isEnvValuePresent } from './env-file.mjs';
import postgres from 'postgres';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const REQUIRED_JOBS = [
	'eigen-event-reminders',
	'eigen-job-queue-tick',
	'eigen-sleep-consolidation'
];

function isProductionRuntime() {
	return process.env.NODE_ENV === 'production';
}

function isCronConfigured() {
	return (
		isEnvValuePresent(process.env.ADMIN_CONSOLIDATION_KEY) &&
		isEnvValuePresent(process.env.DATABASE_ADMIN_URL) &&
		isEnvValuePresent(process.env.CONSOLIDATION_INTERNAL_URL)
	);
}

function runScript(name) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(scriptsDir, name)], {
			stdio: 'inherit',
			env: process.env
		});
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${name} exited with code ${code}`));
		});
	});
}

async function verifyCronJobs() {
	if (!isProductionRuntime()) {
		console.log('[eigen] skipping cron verification (NODE_ENV is not production)');
		return;
	}

	const raw = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim();
	if (!raw) {
		throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required for cron verification');
	}

	const sql = postgres(raw, { max: 1 });
	try {
		const rows = await sql`
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
}

ensureDeploySecrets();

if (!isCronConfigured()) {
	if (isProductionRuntime() && isEnvValuePresent(process.env.DATABASE_ADMIN_URL)) {
		console.error(
			'[eigen] pg_cron bootstrap skipped — ADMIN_CONSOLIDATION_KEY or CONSOLIDATION_INTERNAL_URL missing after secret bootstrap'
		);
		process.exit(0);
	}

	console.log(
		'[eigen] pg_cron bootstrap skipped (local/dev — set ADMIN_CONSOLIDATION_KEY, DATABASE_ADMIN_URL, CONSOLIDATION_INTERNAL_URL for production)'
	);
	process.exit(0);
}

try {
	await runScript('ensure-sleep-cron.mjs');
	await runScript('ensure-reminder-cron.mjs');
	await runScript('ensure-job-queue-cron.mjs');
	await verifyCronJobs();
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	console.error('[eigen] pg_cron bootstrap failed — app will still start', { message });
	console.error(
		'[eigen] Scheduled push notifications and pg_cron queue ticks may not run until this is fixed. In-process job queue ticker remains active.'
	);
}
