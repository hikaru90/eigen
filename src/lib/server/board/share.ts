import type {
  BoardArea,
  BoardCheckResult,
  BoardKind,
  BoardShareResult,
} from '$lib/feedback/board-types'
import {
  assertFeedbackMailConfigured,
  sendFeedbackInboxEmail,
} from '$lib/server/feedback/send-feedback-email'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { judgeBoardIdea } from './judge'
import { findDuplicateCandidates, getBoardIdea, insertBoardIdea, loadUserEmail } from './service'

/** How many similar open ideas the judge compares against. */
const DUPLICATE_CANDIDATES = 5

/**
 * MB-9 check: embed the draft title (DB-only vector), rank open ideas by
 * similarity, and let the LLM judge pick kind, area and an optional duplicate.
 * Nothing is created here.
 */
export async function checkBoardIdea(userId: string, title: string): Promise<BoardCheckResult> {
  const embedding = await createThoughtEmbedding(userId, title)
  const candidates = await findDuplicateCandidates(embedding, DUPLICATE_CANDIDATES)
  const decision = await judgeBoardIdea({ userId, title, candidates })
  const duplicateOf = decision.duplicateOfId
    ? await getBoardIdea(userId, decision.duplicateOfId)
    : null
  return { kind: decision.kind, area: decision.area, duplicateOf }
}

/**
 * MB-4: create the idea (with the author's +1) and its inbox row, then email the
 * makers. D4: an email failure keeps the idea and is reported as `inbox: 'failed'`.
 */
export async function shareBoardIdea(input: {
  userId: string
  title: string
  kind: BoardKind
  area: BoardArea
}): Promise<BoardShareResult> {
  const embedding = await createThoughtEmbedding(input.userId, input.title)
  const { ideaId, feedbackId } = await insertBoardIdea({ ...input, embedding })
  const idea = await getBoardIdea(input.userId, ideaId)
  if (!idea) throw new Error(`Shared idea ${ideaId} is not readable after insert`)

  try {
    assertFeedbackMailConfigured()
    const userEmail = await loadUserEmail(input.userId)
    await sendFeedbackInboxEmail({
      feedbackId,
      userId: input.userId,
      userEmail,
      message: `[${input.kind} · ${input.area}] ${input.title}`,
    })
    return { idea, inbox: 'sent' }
  } catch (err) {
    const inboxError = err instanceof Error ? err.message : String(err)
    console.error('[board.share] inbox email failed; idea kept', { ideaId, inboxError })
    return { idea, inbox: 'failed', inboxError }
  }
}
