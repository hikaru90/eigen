import { getOrCreateSession, runAskTurn } from '$lib/server/chat/run-ask-turn'
import type { RetrievalContextItem } from '$lib/server/qa/compose-answer'
import { withComposeObserver } from '$lib/server/qa/compose-observer'
import { withEvalDb } from '../harness/eval-context'

export type AskAnswer = {
  /** Ask's final answer text. */
  answer: string
  toolNames: string[]
  /** Full context of every answer_question call Ask made (deduplicated by thought id). */
  context: RetrievalContextItem[]
  /** Ask never called answer_question: the chooser gets no memory. No composeAnswer fallback. */
  askAnsweredWithoutMemory: boolean
}

/**
 * `--answer ask`: the bare query goes through the real Ask agent in a NEW session, under the
 * eval clock `referenceTime` (so answer_question's reference_time is the eval clock). The
 * compose observer records the ComposedAnswer of each answer_question call, so the chooser
 * sees everything Ask was given, not only what it cited; the agent sees nothing different.
 */
export async function answerViaAsk(input: {
  tenantUserId: string
  query: string
  referenceTime: Date
  billing: { billingUserId: string; chatModel: string }
}): Promise<AskAnswer> {
  const { tenantUserId, query, referenceTime, billing } = input
  const { result, observed } = await withComposeObserver(tenantUserId, () =>
    withEvalDb(
      tenantUserId,
      async (db) => {
        const { sessionId } = await getOrCreateSession(db, tenantUserId, null, 'default')
        return runAskTurn({ db, userId: tenantUserId, sessionId, message: query })
      },
      { ...billing, clock: referenceTime },
    ),
  )
  const byId = new Map<string, RetrievalContextItem>()
  for (const composed of observed) {
    for (const item of composed.context) if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return {
    answer: result.answer,
    toolNames: result.toolCalls.map((c) => c.tool),
    context: [...byId.values()],
    askAnsweredWithoutMemory: observed.length === 0,
  }
}
