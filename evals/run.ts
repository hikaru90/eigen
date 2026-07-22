/**
 * Eval CLI — same modes as /eval UI (smoke | all).
 *
 * Usage:
 *   npm run eval              # smoke
 *   npm run eval -- --mode all
 *   npm run eval -- --mode qa --qa-id qa_smoke_dinner
 *   npm run eval -- --fresh-corpus
 */
import { insertEvalUserRow } from '../src/lib/eval/store'
import { startEvalRun } from '../src/lib/eval/runner'
import { withDbUser } from '../src/lib/server/db'
import { runEval, logEval } from './harness/eval-context'
import { EVAL_OPERATOR_USER_ID, EVAL_JUDGE_USER_ID } from './harness/eval-config'
import { parseEvalCliArgs } from './harness/corpus-reuse'
import { loadEvalRunDetail } from '../src/lib/eval/store'

async function ensureOperatorUser(): Promise<void> {
  await insertEvalUserRow(EVAL_OPERATOR_USER_ID, 'Eval Operator')
  await insertEvalUserRow(EVAL_JUDGE_USER_ID, 'Eval Judge')
}

async function main(): Promise<void> {
  const { mode, qaId, freshCorpus } = parseEvalCliArgs(process.argv.slice(2))
  await ensureOperatorUser()

  const { runId } = await withDbUser(EVAL_OPERATOR_USER_ID, () =>
    startEvalRun({
      operatorUserId: EVAL_OPERATOR_USER_ID,
      mode,
      qaId,
      freshCorpus,
    }),
  )

  logEval(`started run ${runId} (mode=${mode}); waiting for completion…`)

  for (;;) {
    await new Promise((r) => setTimeout(r, 2000))
    const detail = await loadEvalRunDetail(EVAL_OPERATOR_USER_ID, runId)
    if (!detail) throw new Error(`run not found: ${runId}`)
    if (detail.run.status === 'completed' || detail.run.status === 'failed') {
      logEval(
        `run finished: status=${detail.run.status} passed=${detail.run.passedCount}/${detail.run.entryCount}`,
      )
      const synthesis = detail.run.synthesis
      if (synthesis && typeof synthesis === 'object' && 'narrative' in synthesis) {
        const narrative = (synthesis as { narrative?: string }).narrative
        if (narrative) {
          console.log('\n--- Synthesis ---\n')
          console.log(narrative)
        }
      }
      if (detail.run.status === 'failed') {
        throw new Error(detail.run.error ?? 'eval run failed')
      }
      return
    }
  }
}

void runEval(main)
