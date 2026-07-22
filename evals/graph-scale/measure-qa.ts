import { randomUUID } from 'node:crypto'
import { composeAnswer } from '$lib/server/qa/compose-answer'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { withEvalDb } from '../harness/eval-context'
import { aggregateActivityCostByGroupId } from './aggregate-cost'
import type { GraphScaleQaResult } from './types'

/** Fixed queries aligned with the single-thought graph-scale corpus themes. */
export const GRAPH_SCALE_QA_QUERIES = [
  'What errands or shopping did I note?',
  'What items did I need to pick up or buy?',
  'What returns or pickups did I mention?',
  'What appointments or schedule changes did I capture?',
  'What medical or health appointments do I have coming up?',
  'What sessions or visits were rescheduled?',
  'What home maintenance tasks did I mention?',
  'What repairs or fixes did I note around the house?',
  'What cleaning or household chores did I capture?',
  'What work tasks or follow-ups did I write down?',
  'What deadlines or deliverables did I mention?',
  'What emails or status updates do I need to send?',
  'What health or fitness notes do I have?',
  'What exercise or wellness habits did I note?',
  'What bills or payments did I mention?',
  'What budget or financial tasks did I capture?',
  'What administrative tasks or renewals did I note?',
  'What subscriptions or registrations need attention?',
  'What ideas or productivity tips did I jot down?',
  'What habits or routines did I want to try?',
] as const

function percentile95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return sorted[Math.max(0, idx)] ?? 0
}

export async function measureGraphScaleQaSet(input: {
  userId: string
  billingUserId: string
  questions?: readonly string[]
  onQueryComplete?: (query: {
    questionIndex: number
    questionCount: number
    question: string
    wallMs: number
    usd: string
    credits: number
  }) => void
}): Promise<GraphScaleQaResult> {
  const questions = input.questions ?? GRAPH_SCALE_QA_QUERIES
  const perQuery: GraphScaleQaResult['perQuery'] = []
  const wallSamples: number[] = []
  const questionCount = questions.length
  const traceGroupId = randomUUID()

  for (const question of questions) {
    const queryGroupId = randomUUID()
    const questionIndex = perQuery.length + 1
    const startedAt = Date.now()

    await withEvalDb(
      input.userId,
      () =>
        runWithTrace(queryGroupId, () =>
          composeAnswer({
            userId: input.userId,
            question,
          }),
        ),
      { billingUserId: input.billingUserId },
    )

    const wallMs = Date.now() - startedAt
    wallSamples.push(wallMs)

    const cost = await withEvalDb(input.userId, (db) =>
      aggregateActivityCostByGroupId(db, input.userId, queryGroupId),
    )

    perQuery.push({
      question,
      wallMs,
      usd: cost.totalUsd,
      credits: cost.totalCredits,
    })
    input.onQueryComplete?.({
      questionIndex,
      questionCount,
      question,
      wallMs,
      usd: cost.totalUsd,
      credits: cost.totalCredits,
    })
  }

  let usdSum = 0
  let creditsSum = 0
  for (const row of perQuery) {
    usdSum += Number(row.usd)
    creditsSum += row.credits
  }

  const queryCount = perQuery.length
  const usdTotal = usdSum.toFixed(6)
  const usdPerQuery = queryCount > 0 ? (usdSum / queryCount).toFixed(6) : '0.000000'

  return {
    usdTotal,
    creditsTotal: creditsSum,
    usdPerQuery,
    creditsPerQuery: queryCount > 0 ? creditsSum / queryCount : 0,
    p95Ms: percentile95(wallSamples),
    queryCount,
    perQuery,
    groupId: traceGroupId,
  }
}
