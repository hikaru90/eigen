/**
 * One-shot: align stored eval_run.status with point-based scores for the current release.
 *
 *   node scripts/reconcile-eval-runs.mjs
 *   node scripts/reconcile-eval-runs.mjs --operator <user-id>
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const APP_VERSION = packageJson.version;

const { appSql } = await import('../src/lib/server/db/index.ts');
const { reconcileVersionEvalRuns } = await import('../src/lib/eval/store.ts');

function parseOperator(argv) {
	for (let i = 0; i < argv.length; i += 1) {
		if ((argv[i] === '--operator' || argv[i] === '--operator-user-id') && argv[i + 1]) {
			return argv[++i].trim();
		}
	}
	return null;
}

const operatorArg = parseOperator(process.argv.slice(2));

const operators = operatorArg
	? [{ user_id: operatorArg }]
	: await appSql`
			SELECT DISTINCT user_id
			FROM eval_run
			WHERE config_json->>'appVersion' = ${APP_VERSION}
		`;

let total = 0;
for (const row of operators) {
	const n = await reconcileVersionEvalRuns(row.user_id);
	if (n > 0) {
		console.log(`reconciled ${n} run(s) for ${row.user_id}`);
	}
	total += n;
}

console.log(`done: ${total} updated for v${APP_VERSION}`);
await appSql.end();
