/**
 * Delete a corpus fixture's stored thought so the next eval run re-captures it.
 *
 *   npm run eval:reset-fixture -- --fixture ec_jonas_silence
 *   npm run eval:reset-fixture -- --fixture ec_jonas_silence --operator <your-user-id>
 */
import { deleteThoughtVertexFromGraph } from '../src/lib/server/graph/age'
import { appSql } from '../src/lib/server/db'
import { insertEvalUserRow } from '../src/lib/eval/store'
import { EVAL_OPERATOR_USER_ID, EVAL_JUDGE_USER_ID, evalCorpusUserId } from './harness/eval-config'
import { runEval, logEval, withEvalDb } from './harness/eval-context'

function parseArgs(argv: string[]): { fixtureId: string; operatorUserId?: string } {
  let fixtureId = ''
  let operatorUserId: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture' && argv[i + 1]) {
      fixtureId = argv[++i]!.trim()
    } else if ((argv[i] === '--operator' || argv[i] === '--operator-user-id') && argv[i + 1]) {
      operatorUserId = argv[++i]!.trim()
    }
  }
  if (!fixtureId) {
    throw new Error('--fixture is required (e.g. ec_jonas_silence)')
  }
  return { fixtureId, operatorUserId }
}

async function findFixtureThoughts(
  fixtureId: string,
  operatorUserId?: string,
): Promise<Array<{ evalUserId: string; thoughtId: string }>> {
  if (operatorUserId) {
    const evalUserId = evalCorpusUserId(operatorUserId)
    const rows = await appSql<{ eval_user_id: string; thought_id: string }[]>`
			SELECT DISTINCT ON (etm.thought_id)
				${evalUserId}::text AS eval_user_id,
				etm.thought_id AS thought_id
			FROM eval_thought_map etm
			INNER JOIN eval_run er ON er.id = etm.run_id
			WHERE etm.fixture_id = ${fixtureId}
				AND er.eval_user_id = ${evalUserId}
		`
    return rows.map((row) => ({
      evalUserId: row.eval_user_id,
      thoughtId: row.thought_id,
    }))
  }

  const rows = await appSql<{ eval_user_id: string; thought_id: string }[]>`
		SELECT DISTINCT er.eval_user_id AS eval_user_id, etm.thought_id AS thought_id
		FROM eval_thought_map etm
		INNER JOIN eval_run er ON er.id = etm.run_id
		WHERE etm.fixture_id = ${fixtureId}
	`
  const seen = new Set<string>()
  const out: Array<{ evalUserId: string; thoughtId: string }> = []
  for (const row of rows) {
    const evalUserId = row.eval_user_id ?? ''
    const thoughtId = row.thought_id ?? ''
    if (!evalUserId || !thoughtId) continue
    const key = `${evalUserId}:${thoughtId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ evalUserId, thoughtId })
  }
  return out
}

async function main(): Promise<void> {
  const { fixtureId, operatorUserId } = parseArgs(process.argv.slice(2))
  await insertEvalUserRow(EVAL_OPERATOR_USER_ID, 'Eval Operator')
  await insertEvalUserRow(EVAL_JUDGE_USER_ID, 'Eval Judge')

  const targets = await findFixtureThoughts(fixtureId, operatorUserId)
  if (targets.length === 0) {
    logEval(
      `no mapped thought for fixture ${fixtureId}${operatorUserId ? ` (operator ${operatorUserId})` : ''}`,
    )
    return
  }

  for (const { evalUserId, thoughtId } of targets) {
    const deleted = await withEvalDb(evalUserId, async () => {
      const rows = await appSql<{ id: string }[]>`
				SELECT id FROM thought
				WHERE user_id = ${evalUserId} AND id = ${thoughtId}
				LIMIT 1
			`
      if (rows.length === 0) return false
      await deleteThoughtVertexFromGraph({ userId: evalUserId, thoughtId })
      await appSql`
				DELETE FROM thought
				WHERE user_id = ${evalUserId} AND id = ${thoughtId}
			`
      return true
    })
    if (!deleted) {
      logEval(`skip ${fixtureId} on ${evalUserId}: thought ${thoughtId} not found`)
      continue
    }
    logEval(`deleted ${fixtureId}: thought ${thoughtId} (tenant ${evalUserId})`)
  }

  logEval(
    `done — re-run one QA: npm run eval -- --mode qa --qa-id qa_jonas_creative_silence` +
      ' or use Run on that row in /eval',
  )
}

void runEval(main)
