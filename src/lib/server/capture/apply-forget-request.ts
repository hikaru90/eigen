/**
 * Forget flow at capture (docs/planning/personamem-score-plan.md, S2): the capture was decided as
 * `forget` (capture_intent), so instead of becoming memory it removes memory.
 *
 * 1. Targets: the delete matcher behind `delete_thoughts_by_request` (multi-query retrieval +
 *    the Jev delete_target decision behind its 0.8 confidence gate), restricted to active
 *    thoughts captured strictly BEFORE the forget capture — a fact restated later stays.
 * 2. Per target an LLM judge decides `archive` (only about the forgotten thing) or `edit_out`
 *    (also holds other facts). Both go through the existing services — archiveThoughtForUser and
 *    the natural-language edit (editStoredThought, which re-embeds and re-enriches) — so tenant
 *    isolation, encryption and the graph stay in their owners' hands.
 * 3. The forget capture is archived last so its own text is never retrieved.
 * 4. Never silent: one activity-log row per action plus a summary row (ids and counts only,
 *    never thought text or secret values).
 *
 * Failures propagate (the enrich retry ladder owns recovery); only the documented
 * "ambiguous request" gate result is a recorded non-error outcome that forgets nothing.
 */

import { MEMORY_AUDIT_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers'
import { logActivityCall } from '$lib/server/activity/log-call'
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result'
import { judgeForgetTarget } from '$lib/server/capture/judge-forget-target'
import { editStoredThought } from '$lib/server/capture/service'
import { getDb } from '$lib/server/db'
import { archiveThoughtForUser } from '$lib/server/memory/lifecycle'
import {
  buildDeleteTargetCandidates,
  DeleteGateAmbiguousError,
  resolveDeleteTargets,
  strongDeleteTargetCandidates,
  type DeleteTargetCandidate,
} from '$lib/server/retrieval/resolve-delete-target'
import { retrieveThoughtRowsForDeleteRequest } from '$lib/server/retrieval/retrieve-for-delete'

export type ForgetOutcome = {
  /** applied = at least one thought archived/edited · nothing_matched · ambiguous (delete gate: nothing forgotten). */
  status: 'applied' | 'nothing_matched' | 'ambiguous'
  /** Thought ids archived (whole thought forgotten). */
  archived: string[]
  /** Thought ids edited (only the forgotten detail removed). */
  edited: string[]
}

export const FORGET_AUDIT_OPERATION = 'forget_request'

/** The edit request handed to the natural-language edit service; deliberately not a lifecycle verb. */
function editOutRequest(detail: string): string {
  return `Remove only the following from the thought and keep everything else unchanged: ${detail}`
}

async function audit(userId: string, context: string): Promise<void> {
  await logActivityCall(getDb(), userId, {
    provider: MEMORY_AUDIT_ACTIVITY_PROVIDER,
    operation: FORGET_AUDIT_OPERATION,
    baseCostUsd: 0,
    context,
  })
}

export async function applyForgetRequest(input: {
  userId: string
  captureThoughtId: string
  /** The forget capture's own capture time: only thoughts created before it can be forgotten. */
  captureCreatedAt: Date
  /** The forget capture's (secret-redacted) text. */
  request: string
}): Promise<ForgetOutcome> {
  const { userId, captureThoughtId, request } = input
  const auditPrefix = `forget capture=${captureThoughtId}`

  const { results } = await retrieveThoughtRowsForDeleteRequest({
    userId,
    deleteRequest: request,
    createdBefore: input.captureCreatedAt,
  })
  const candidates = strongDeleteTargetCandidates(buildDeleteTargetCandidates(results))

  let targets: DeleteTargetCandidate[] = []
  let ambiguous = false
  try {
    targets = await resolveDeleteTargets({ userId, deleteRequest: request, candidates })
  } catch (err) {
    if (!(err instanceof DeleteGateAmbiguousError)) throw err
    ambiguous = true
  }

  const archived: string[] = []
  const edited: string[] = []
  for (const target of targets) {
    const current = await loadThoughtCaptureResult(userId, target.thoughtId)
    // archived or completed since retrieval: nothing left to forget
    if (current.lifecycleStatus !== 'open') continue

    const judgement = await judgeForgetTarget({
      userId,
      forgetRequest: request,
      targetText: current.normalizedText,
    })

    if (judgement.action === 'archive') {
      const result = await archiveThoughtForUser(userId, target.thoughtId)
      if (!result.ok) throw new Error(`forget: thought ${target.thoughtId} not found`)
      archived.push(target.thoughtId)
      await audit(userId, `${auditPrefix} archived=${target.thoughtId}`)
      continue
    }

    const edit = await editStoredThought(userId, target.thoughtId, editOutRequest(judgement.detail))
    if (!edit.ok) throw new Error(`forget: thought ${target.thoughtId} not found`)
    if (edit.thought.normalizedText === current.normalizedText) {
      // the detail would still be remembered: fail loud, the retry ladder asks the model again
      throw new Error(`forget: edit_out left thought ${target.thoughtId} unchanged`)
    }
    edited.push(target.thoughtId)
    await audit(userId, `${auditPrefix} edited=${target.thoughtId}`)
  }

  // The forget capture is an instruction, not memory: archive it so its text is never retrieved.
  const captureArchived = await archiveThoughtForUser(userId, captureThoughtId)
  if (!captureArchived.ok) throw new Error(`forget: capture ${captureThoughtId} not found`)

  const status: ForgetOutcome['status'] = ambiguous
    ? 'ambiguous'
    : archived.length + edited.length > 0
      ? 'applied'
      : 'nothing_matched'
  await audit(
    userId,
    `${auditPrefix} status=${status} archived=${archived.length} edited=${edited.length}`,
  )
  return { status, archived, edited }
}
