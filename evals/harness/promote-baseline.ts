/**
 * Promote the most recent unified eval report to the checked-in baseline.
 *
 * Usage: `npm run eval:baseline`
 */
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASELINES_DIR, REPORTS_DIR } from './report';

function main(): void {
	const latest = resolve(REPORTS_DIR, 'eval-latest.json');
	if (!existsSync(latest)) {
		throw new Error(
			`[eval] no latest report found (expected ${latest}). Run an eval first.`
		);
	}
	mkdirSync(BASELINES_DIR, { recursive: true });
	const dest = resolve(BASELINES_DIR, 'eval.json');
	copyFileSync(latest, dest);
	console.log(`[eval] promoted ${latest}\n           -> ${dest}`);
}

try {
	main();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
