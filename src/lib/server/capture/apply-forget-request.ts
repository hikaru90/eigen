/**
 * Forget flow at capture (docs/planning/personamem-score-plan.md, S2 and S2b): the capture was
 * decided as `forget` (capture_intent), so instead of becoming memory it removes memory.
 *
 * 1. Find XYZ first: the same retrieval Ask uses (thoughts and note passages), run for every
 *    LLM-derived target phrase, restricted to items stored strictly BEFORE the forget capture — a
 *    fact restated later stays (`findForgetHits`).
 * 2. Decide per hit with its full text: one LLM judge call returns `remove_all | remove_detail |
 *    keep` with a confidence per hit (`judgeForgetHits`). Removals at or above
 *    FORGET_CONFIDENCE_MIN are applied; every hit below it is left untouched and recorded as
 *    unresolved. There is no all-or-nothing gate: one unsure hit never blocks the others.
 * 3. Apply through the owners' services, so tenant isolation, encryption, passages and the graph
 *    stay in their hands:
 *      thought remove_all    -> archiveThoughtForUser
 *      thought remove_detail -> editStoredThought (natural-language edit; generic edit label, so
 *                               the stored edit metadata never keeps the forgotten detail)
 *      note remove_detail    -> removeDetailFromNote (matched passages rewritten, note saved as an
 *                               agent write: passages rebuild, secret placeholders restored)
 *      note remove_all       -> archiveTextFile (`text_file.archived_at`; never a hard delete)
 *      fact remove_all       -> forgetUserFacts (status `forgotten`: out of every search at once,
 *                               its secure value deleted with it)
 *      fact remove_detail    -> removeDetailFromFact (statement rewritten without the detail)
 * 4. Keep the instruction until everything is removed: the forget capture is archived only when at
 *    least one hit was removed and nothing is unresolved. Otherwise it stays an active thought
 *    (the caller records `metadata.forgetInstruction` and lets it through the normal pipeline), so
 *    Ask still sees the request and does not use the information.
 * 5. Never silent: one activity-log row per hit decision, per action and a summary (ids, actions,
 *    confidences and counts only — never text or secret values).
 *
 * Failures propagate (the enrich retry ladder owns recovery); nothing here falls back.
 */

import { MEMORY_AUDIT_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers'
import { logActivityCall } from '$lib/server/activity/log-call'
import type { ForgetInstructionStatus, UnresolvedForgetHit } from '$lib/server/capture/capture-intent'
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result'
import { findForgetHits } from '$lib/server/capture/find-forget-hits'
import { FORGET_CONFIDENCE_MIN, judgeForgetHits } from '$lib/server/capture/judge-forget-hits'
import { removeDetailFromNote } from '$lib/server/capture/remove-note-detail'
import { editStoredThought } from '$lib/server/capture/service'
import { getDb } from '$lib/server/db'
import { removeDetailFromFact } from '$lib/server/facts/remove-fact-detail'
import { forgetUserFacts } from '$lib/server/facts/user-fact-lifecycle'
import { archiveThoughtForUser } from '$lib/server/memory/lifecycle'
import { archiveTextFile } from '$lib/server/text-files/service'

export type ForgetOutcome = {
  /**
   * applied = something removed, nothing unresolved · partial = something removed, something
   * unresolved · unresolved = nothing removed, something unresolved · nothing_removed = hits were
   * judged and none had to go · nothing_found = retrieval found no candidate.
   */
  status: 'applied' | ForgetInstructionStatus
  /** Thought ids archived (whole thought forgotten). */
  archived: string[]
  /** Thought ids edited (only the forgotten detail removed). */
  edited: string[]
  /** Note ids archived (whole note forgotten, restorable). */
  notesArchived: string[]
  /** Note ids edited (only the forgotten detail removed). */
  notesEdited: string[]
  /** Fact ids forgotten (the whole fact, or nothing was left of it). */
  factsForgotten: string[]
  /** Fact ids whose statement was rewritten without the forgotten detail. */
  factsEdited: string[]
  /** Hits left untouched because the judge was not confident enough. */
  unresolved: UnresolvedForgetHit[]
  /** archived = everything was removed · kept = the forget capture stays an active thought. */
  instruction: 'archived' | 'kept'
}

export const FORGET_AUDIT_OPERATION = 'forget_request'

/** Stored in place of the edit request and summary: the edit metadata must not keep the detail. */
export const FORGET_EDIT_LABEL = 'Edited at your request to forget something'

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
  /** The forget capture's own capture time: only items stored before it can be forgotten. */
  captureCreatedAt: Date
  /** The forget capture's (secret-redacted) text. */
  request: string
}): Promise<ForgetOutcome> {
  const { userId, captureThoughtId, request } = input
  const auditPrefix = `forget capture=${captureThoughtId}`

  const { hits } = await findForgetHits({
    userId,
    request,
    createdBefore: input.captureCreatedAt,
  })
  const judged =
    hits.length === 0 ? [] : await judgeForgetHits({ userId, forgetRequest: request, hits })

  for (const j of judged) {
    await audit(
      userId,
      `${auditPrefix} hit=${j.hit.kind}:${j.hit.id} action=${j.action} confidence=${j.confidence.toFixed(2)}`,
    )
  }

  const archived: string[] = []
  const edited: string[] = []
  const notesArchived: string[] = []
  const notesEdited: string[] = []
  const factsForgotten: string[] = []
  const factsEdited: string[] = []
  const unresolved: UnresolvedForgetHit[] = []

  for (const j of judged) {
    const { hit } = j
    if (j.confidence < FORGET_CONFIDENCE_MIN) {
      unresolved.push({ kind: hit.kind, id: hit.id })
      await audit(userId, `${auditPrefix} unresolved=${hit.kind}:${hit.id}`)
      continue
    }
    if (j.action === 'keep') continue

    if (hit.kind === 'thought') {
      const current = await loadThoughtCaptureResult(userId, hit.id)
      // archived or completed since retrieval: nothing left to forget
      if (current.lifecycleStatus !== 'open') continue

      if (j.action === 'remove_all') {
        const result = await archiveThoughtForUser(userId, hit.id)
        if (!result.ok) throw new Error(`forget: thought ${hit.id} not found`)
        archived.push(hit.id)
        await audit(userId, `${auditPrefix} archived=${hit.id}`)
        continue
      }

      const edit = await editStoredThought(userId, hit.id, editOutRequest(j.detail), {
        editLabel: FORGET_EDIT_LABEL,
      })
      if (!edit.ok) throw new Error(`forget: thought ${hit.id} not found`)
      if (edit.thought.normalizedText === current.normalizedText) {
        // the detail would still be remembered: fail loud, the retry ladder asks the model again
        throw new Error(`forget: edit left thought ${hit.id} unchanged`)
      }
      edited.push(hit.id)
      await audit(userId, `${auditPrefix} edited=${hit.id}`)
      continue
    }

    if (hit.kind === 'fact') {
      if (j.action === 'remove_all') {
        // empty: the fact is gone already (retired with its source, or forgotten since retrieval)
        if ((await forgetUserFacts(userId, [hit.id])).length === 0) continue
        factsForgotten.push(hit.id)
        await audit(userId, `${auditPrefix} fact_forgotten=${hit.id}`)
        continue
      }
      const result = await removeDetailFromFact({ userId, factId: hit.id, detail: j.detail })
      if (result === 'gone') continue
      if (result === 'forgotten') {
        factsForgotten.push(hit.id)
        await audit(userId, `${auditPrefix} fact_forgotten=${hit.id}`)
      } else {
        factsEdited.push(hit.id)
        await audit(userId, `${auditPrefix} fact_edited=${hit.id}`)
      }
      continue
    }

    if (j.action === 'remove_all') {
      // false: no active note with that id any more (archived or deleted since retrieval)
      if (!(await archiveTextFile(userId, hit.id))) continue
      notesArchived.push(hit.id)
      await audit(userId, `${auditPrefix} note_archived=${hit.id}`)
      continue
    }

    const result = await removeDetailFromNote({
      userId,
      noteId: hit.id,
      detail: j.detail,
      matchedOrdinals: hit.matchedOrdinals,
    })
    if (result === 'gone') continue
    if (result === 'archived') {
      notesArchived.push(hit.id)
      await audit(userId, `${auditPrefix} note_archived=${hit.id}`)
    } else {
      notesEdited.push(hit.id)
      await audit(userId, `${auditPrefix} note_edited=${hit.id}`)
    }
  }

  const removed =
    archived.length +
    edited.length +
    notesArchived.length +
    notesEdited.length +
    factsForgotten.length +
    factsEdited.length
  const status: ForgetOutcome['status'] =
    hits.length === 0
      ? 'nothing_found'
      : unresolved.length > 0
        ? removed > 0
          ? 'partial'
          : 'unresolved'
        : removed > 0
          ? 'applied'
          : 'nothing_removed'

  // The instruction goes only when everything it was about is gone. Archiving it is the last
  // step, so a failure above leaves it for the retry ladder.
  const instruction: ForgetOutcome['instruction'] = status === 'applied' ? 'archived' : 'kept'
  if (instruction === 'archived') {
    const captureArchived = await archiveThoughtForUser(userId, captureThoughtId)
    if (!captureArchived.ok) throw new Error(`forget: capture ${captureThoughtId} not found`)
  }

  await audit(
    userId,
    `${auditPrefix} status=${status} archived=${archived.length} edited=${edited.length} notes_archived=${notesArchived.length} notes_edited=${notesEdited.length} facts_forgotten=${factsForgotten.length} facts_edited=${factsEdited.length} unresolved=${unresolved.length} instruction=${instruction}`,
  )
  return {
    status,
    archived,
    edited,
    notesArchived,
    notesEdited,
    factsForgotten,
    factsEdited,
    unresolved,
    instruction,
  }
}
