import type { EvalQaRecord } from './qa-store'
import type { VersionEvalOverview, VersionEvalTestResult } from './version-overview-types'
import { sql } from 'drizzle-orm'
import { APP_VERSION } from '$lib/app-version'
import { withDbUser } from '$lib/server/db'
import { aggregateQaScores, formatPointsLine, resolveRunStatusFromScore } from './display'
import { listEvalQa } from './qa-store'
import { loadEvalRunDetail } from './store'

export type { VersionEvalOverview, VersionEvalTestResult } from './version-overview-types'

type RunMetaRow = {
  id: string
  status: string
  label: string
}

async function findLatestRunForQa(
  operatorUserId: string,
  qaId: string,
): Promise<RunMetaRow | null> {
  return withDbUser(operatorUserId, async (db) => {
    const result = await db.execute(sql`
			SELECT er.id, er.status, er.label
			FROM eval_run er
			WHERE er.config_json->>'appVersion' = ${APP_VERSION}
			  AND (er.scenario_id = ${qaId}
			   OR er.label = ${'qa:' + qaId}
			   OR er.label = ${'smoke:' + qaId}
			   OR er.id IN (
			     SELECT ee.run_id
			     FROM eval_entry ee
			     WHERE ee.input_json->>'qaId' = ${qaId}
			        OR ee.fixture_ref LIKE ${qaId + '%'}
			   ))
			ORDER BY
			  er.created_at DESC,
			  (CASE WHEN er.label LIKE 'qa:%' OR er.label LIKE 'smoke:%' THEN 0 ELSE 1 END)
			LIMIT 1
		`)
    const rows = Array.isArray(result) ? result : [...(result as unknown as Iterable<Record<string, unknown>>)]
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row?.id) return null
    return {
      id: String(row.id),
      status: String(row.status),
      label: String(row.label),
    }
  })
}

async function buildTestResult(
  operatorUserId: string,
  qa: EvalQaRecord,
): Promise<VersionEvalTestResult> {
  const meta = await findLatestRunForQa(operatorUserId, qa.id)
  if (!meta) {
    return {
      qaId: qa.id,
      question: qa.question,
      tags: qa.tags,
      active: !qa.tags.includes('inactive'),
      runId: null,
      runStatus: null,
      runLabel: null,
      scoreLine: null,
      scorePercent: null,
    }
  }

  const detail = await loadEvalRunDetail(operatorUserId, meta.id)
  const score = detail ? aggregateQaScores(detail.entries, qa) : null

  return {
    qaId: qa.id,
    question: qa.question,
    tags: qa.tags,
    active: !qa.tags.includes('inactive'),
    runId: meta.id,
    runStatus: resolveRunStatusFromScore(meta.status, score),
    runLabel: meta.label,
    scoreLine: score ? formatPointsLine(score.earned, score.possible) : null,
    scorePercent: score?.percent ?? null,
  }
}

export async function loadVersionEvalOverview(
  operatorUserId: string,
): Promise<VersionEvalOverview> {
  const qas = await withDbUser(operatorUserId, () => listEvalQa())
  const tests = await Promise.all(qas.map((qa) => buildTestResult(operatorUserId, qa)))
  return { version: APP_VERSION, tests }
}
