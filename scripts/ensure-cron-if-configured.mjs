/**
 * Bootstrap pg_cron jobs for production deployments.
 * In production (NODE_ENV=production), scheduling is mandatory when DATABASE_ADMIN_URL is set.
 */
import './load-env.mjs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnvValuePresent } from './env-file.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

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

if (!isCronConfigured()) {
	if (isProductionRuntime() && isEnvValuePresent(process.env.DATABASE_ADMIN_URL)) {
		throw new Error(
			'pg_cron bootstrap requires ADMIN_CONSOLIDATION_KEY and CONSOLIDATION_INTERNAL_URL in production'
		);
	}

	console.log(
		'[eigen] pg_cron bootstrap skipped (local/dev — set ADMIN_CONSOLIDATION_KEY, DATABASE_ADMIN_URL, CONSOLIDATION_INTERNAL_URL for production)'
	);
	process.exit(0);
}

await runScript('ensure-sleep-cron.mjs');
await runScript('ensure-reminder-cron.mjs');
await runScript('ensure-job-queue-cron.mjs');
