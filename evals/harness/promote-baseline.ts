/**
 * Promote the most recent retrieval/answer report to the checked-in baseline.
 *
 * Usage: `npm run eval:baseline -- retrieval`  or  `... -- answer`  or `... -- both`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASELINES_DIR, REPORTS_DIR } from './report';
import { copyFileSync, mkdirSync } from 'node:fs';

function promote(name: 'retrieval' | 'answer'): void {
	const latest = resolve(REPORTS_DIR, `${name}-latest.json`);
	if (!existsSync(latest)) {
		throw new Error(
			`[eval] no latest report found for "${name}" (expected ${latest}). Run the eval first.`
		);
	}
	mkdirSync(BASELINES_DIR, { recursive: true });
	const dest = resolve(BASELINES_DIR, `${name}.json`);
	copyFileSync(latest, dest);
	console.log(`[eval] promoted ${latest}\n           -> ${dest}`);
}

function main(): void {
	const target = process.argv[2];
	if (!target) {
		throw new Error('[eval] missing argument; expected "retrieval", "answer", or "both"');
	}
	if (target === 'retrieval' || target === 'answer') {
		promote(target);
	} else if (target === 'both') {
		promote('retrieval');
		promote('answer');
	} else {
		throw new Error(`[eval] unknown target "${target}"; expected "retrieval", "answer", or "both"`);
	}
}

try {
	main();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
