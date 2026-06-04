/**
 * Eval CLI — same modes as /eval UI (smoke | all).
 *
 * Usage:
 *   npm run eval              # smoke
 *   npm run eval -- --mode all
 *   npm run eval -- --mode qa --qa-id qa_smoke_dinner
 */
import { insertEvalUserRow } from '../src/lib/eval/store';
import { startEvalRun } from '../src/lib/eval/runner';
import { withDbUser } from '../src/lib/server/db';
import { runEval, logEval } from './harness/eval-context';
import { EVAL_OPERATOR_USER_ID, EVAL_JUDGE_USER_ID } from './harness/eval-config';
import { loadEvalRunDetail } from '../src/lib/eval/store';
import type { EvalRunMode } from '../src/lib/eval/runner';

function parseArgs(): { mode: EvalRunMode; qaId?: string; keepEvalUser: boolean } {
	const args = process.argv.slice(2);
	let mode: EvalRunMode = 'smoke';
	let qaId: string | undefined;
	let keepEvalUser = false;
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === '--mode' && args[i + 1]) {
			const next = args[++i]!;
			if (next === 'smoke' || next === 'all' || next === 'qa') {
				mode = next;
			} else {
				throw new Error(`--mode must be smoke, all, or qa, got: ${next}`);
			}
		} else if ((args[i] === '--qa-id' || args[i] === '--qaId') && args[i + 1]) {
			qaId = args[++i]!;
		} else if (args[i] === '--keep-eval-user') {
			keepEvalUser = true;
		}
	}
	return { mode, qaId, keepEvalUser };
}

async function ensureOperatorUser(): Promise<void> {
	await insertEvalUserRow(EVAL_OPERATOR_USER_ID, 'Eval Operator');
	await insertEvalUserRow(EVAL_JUDGE_USER_ID, 'Eval Judge');
}

async function main(): Promise<void> {
	const { mode, qaId, keepEvalUser } = parseArgs();
	await ensureOperatorUser();

	const { runId } = await withDbUser(EVAL_OPERATOR_USER_ID, () =>
		startEvalRun({
			operatorUserId: EVAL_OPERATOR_USER_ID,
			mode,
			qaId,
			keepEvalUser
		})
	);

	logEval(`started run ${runId} (mode=${mode}); waiting for completion…`);

	for (;;) {
		await new Promise((r) => setTimeout(r, 2000));
		const detail = await loadEvalRunDetail(EVAL_OPERATOR_USER_ID, runId);
		if (!detail) throw new Error(`run not found: ${runId}`);
		if (detail.run.status === 'completed' || detail.run.status === 'failed') {
			logEval(
				`run finished: status=${detail.run.status} passed=${detail.run.passedCount}/${detail.run.entryCount}`
			);
			const synthesis = detail.run.synthesis;
			if (synthesis && typeof synthesis === 'object' && 'narrative' in synthesis) {
				const narrative = (synthesis as { narrative?: string }).narrative;
				if (narrative) {
					console.log('\n--- Synthesis ---\n');
					console.log(narrative);
				}
			}
			if (detail.run.status === 'failed') {
				throw new Error(detail.run.error ?? 'eval run failed');
			}
			return;
		}
	}
}

void runEval(main);
