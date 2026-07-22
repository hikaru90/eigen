import { captureThought } from '$lib/server/capture/service'
import { createIngestPhaseTimer } from '$lib/server/capture/phase-timing'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { withEvalDb } from '../harness/eval-context'
import { aggregateActivityCostByGroupId } from './aggregate-cost'
import type { GraphScaleCaptureProbe } from './types'

export const GRAPH_SCALE_PROBE_TEXT = 'Send the revised invoice to accounting before Friday close.'

export async function measureGraphScaleCaptureProbe(input: {
  userId: string
  billingUserId: string
  groupId: string
  rawText?: string
}): Promise<GraphScaleCaptureProbe> {
  const ingestTimer = createIngestPhaseTimer()
  const startedAt = Date.now()
  const rawText = input.rawText?.trim() || GRAPH_SCALE_PROBE_TEXT

  await withEvalDb(
    input.userId,
    () =>
      runWithTrace(input.groupId, () =>
        captureThought(input.userId, rawText, {
          ingestTimer,
          awaitEnrichment: true,
        }),
      ),
    { billingUserId: input.billingUserId },
  )

  const timing = ingestTimer.finish()
  const wallMs = Date.now() - startedAt

  const cost = await withEvalDb(input.userId, (db) =>
    aggregateActivityCostByGroupId(db, input.userId, input.groupId),
  )

  const phases: Record<string, number> = {}
  for (const entry of timing.phases) {
    phases[entry.phase] = (phases[entry.phase] ?? 0) + entry.ms
  }

  return {
    usd: cost.totalUsd,
    credits: cost.totalCredits,
    wallMs,
    phases,
    groupId: input.groupId,
  }
}
