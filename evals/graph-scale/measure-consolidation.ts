import { consolidateForUser } from '$lib/server/consolidation/runner'
import {
  getCommunitySummaryStats,
  type CommunitySummaryStats,
} from '$lib/server/consolidation/community-summaries'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { withEvalDb } from '../harness/eval-context'
import { aggregateActivityCostByGroupId } from './aggregate-cost'
import type { GraphScaleConsolidationResult } from './types'

function parseSummaryGenerated(detail: string | undefined): number {
  if (!detail) return 0
  const match = detail.match(/(\d+)\s+generated/i)
  if (match) return Number(match[1])
  const summarizedMatch = detail.match(/(\d+)\s+of\s+(\d+)\s+summarized/i)
  if (summarizedMatch) return Number(summarizedMatch[1])
  return 0
}

export async function measureGraphScaleConsolidation(input: {
  userId: string
  billingUserId: string
  groupId: string
}): Promise<GraphScaleConsolidationResult> {
  let beforeStats: CommunitySummaryStats = { total: 0, summarized: 0, pending: 0 }

  await withEvalDb(
    input.userId,
    async () => {
      beforeStats = await getCommunitySummaryStats(input.userId)
    },
    { billingUserId: input.billingUserId },
  )

  const startedAt = Date.now()
  let summaryDetail: string | undefined

  await withEvalDb(
    input.userId,
    () =>
      runWithTrace(input.groupId, async () => {
        const result = await consolidateForUser(input.userId)
        const summaryJob = result.jobs.find((j) => j.job === 'community_summaries')
        summaryDetail = summaryJob?.detail
      }),
    { billingUserId: input.billingUserId },
  )

  const wallMs = Date.now() - startedAt

  const afterStats = await withEvalDb(
    input.userId,
    async () => getCommunitySummaryStats(input.userId),
    { billingUserId: input.billingUserId },
  )

  const cost = await withEvalDb(input.userId, (db) =>
    aggregateActivityCostByGroupId(db, input.userId, input.groupId),
  )

  const communitiesGenerated = parseSummaryGenerated(summaryDetail)
  const communitiesSummarized = Math.max(0, afterStats.summarized - beforeStats.summarized)

  return {
    usd: cost.totalUsd,
    credits: cost.totalCredits,
    wallMs,
    communitiesTotal: afterStats.total,
    communitiesSummarized: communitiesSummarized || afterStats.summarized,
    communitiesPending: afterStats.pending,
    communitiesGenerated: communitiesGenerated || communitiesSummarized,
    groupId: input.groupId,
  }
}
