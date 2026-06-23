/**
 * Bootstrap pg_cron jobs when consolidation env is configured.
 * Skips silently when ADMIN_CONSOLIDATION_KEY or DATABASE_ADMIN_URL are unset.
 */
import './load-env.mjs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

function isConfigured() {
	return Boolean(
		process.env.ADMIN_CONSOLIDATION_KEY?.trim() && process.env.DATABASE_ADMIN_URL?.trim()
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

if (!isConfigured()) {
	console.log(
		'[eigen] ADMIN_CONSOLIDATION_KEY or DATABASE_ADMIN_URL unset — skipping pg_cron schedule.'
	);
	process.exit(0);
}

await runScript('ensure-sleep-cron.mjs');
await runScript('ensure-reminder-cron.mjs');
