import type { BelowFloor } from './types'
import {
  composeAnswer,
  formatComposedAnswerForUser,
  type RetrievalContextItem,
} from '$lib/server/qa/compose-answer'
import { withComposeObserver } from '$lib/server/qa/compose-observer'
import { withEvalDb } from '../harness/eval-context'
import { mergeBelowFloor } from './below-floor'

export type ComposeDirectAnswer = {
  answerText: string
  /** Everything composeAnswer gave its answer model. */
  context: RetrievalContextItem[]
  citedIds: string[]
  belowFloor: BelowFloor
}

/**
 * `--answer compose`: composeAnswer on the bare query, under the observer so the relevance
 * floor's near misses are recorded (harness users only; composeAnswer behaves the same).
 */
export async function answerViaCompose(input: {
  tenantUserId: string
  query: string
  referenceTime: Date
  billing: { billingUserId: string; chatModel: string }
}): Promise<ComposeDirectAnswer> {
  const { tenantUserId, query, referenceTime, billing } = input
  const { result, belowFloor } = await withComposeObserver(tenantUserId, () =>
    withEvalDb(
      tenantUserId,
      () => composeAnswer({ userId: tenantUserId, question: query, referenceTime }),
      billing,
    ),
  )
  return {
    answerText: formatComposedAnswerForUser(result.answer),
    context: result.context,
    citedIds: result.retrieved.map((item) => item.id),
    belowFloor: mergeBelowFloor(belowFloor),
  }
}
