/**
 * Vocabulary of the capture-intent decision (docs/planning/personamem-score-plan.md, S2) and the
 * marker persisted on the capture's own thought. Pure — no DB, no LLM — so the decision plane
 * and the enrich worker share one source.
 */

/** store = the text is something to remember · forget = the user asks Eigen to forget something. */
export const CAPTURE_INTENTS = ['store', 'forget'] as const
export type CaptureIntent = (typeof CAPTURE_INTENTS)[number]

export function isCaptureIntent(value: unknown): value is CaptureIntent {
  return typeof value === 'string' && (CAPTURE_INTENTS as readonly string[]).includes(value)
}

/**
 * Reads the persisted intent off a capture's decrypted metadata (`metadata.captureIntent`).
 * Undefined = not decided yet. A marker outside the vocabulary throws — no silent default.
 */
export function readCaptureIntent(metadata: Record<string, unknown>): CaptureIntent | undefined {
  const marker = metadata.captureIntent
  if (marker === undefined || marker === null) return undefined
  if (!isCaptureIntent(marker)) {
    throw new Error(
      `captureIntent marker is malformed: must be one of ${CAPTURE_INTENTS.join(' | ')}`,
    )
  }
  return marker
}

/**
 * What is left of a forget request after it was applied (docs/planning/personamem-score-plan.md,
 * S2b). The instruction is archived only when everything it was about was removed; in every
 * other state it stays an active thought, so Ask still sees the request.
 *
 * nothing_found = retrieval found no candidate · nothing_removed = candidates were judged and
 * none had to go · unresolved = candidates are left whose judgement was not confident enough ·
 * partial = some removed, some left unresolved.
 */
export const FORGET_INSTRUCTION_STATUSES = [
  'nothing_found',
  'nothing_removed',
  'unresolved',
  'partial',
] as const
export type ForgetInstructionStatus = (typeof FORGET_INSTRUCTION_STATUSES)[number]

/** A hit the forget flow left untouched and recorded (ids only, never text). */
export type UnresolvedForgetHit = { kind: 'thought' | 'note'; id: string }

export type ForgetInstructionMarker = {
  status: ForgetInstructionStatus
  unresolved: UnresolvedForgetHit[]
}

function isUnresolvedForgetHit(value: unknown): value is UnresolvedForgetHit {
  if (!value || typeof value !== 'object') return false
  const { kind, id } = value as { kind?: unknown; id?: unknown }
  return (kind === 'thought' || kind === 'note') && typeof id === 'string' && id.length > 0
}

/**
 * Reads the marker (`metadata.forgetInstruction`) off a forget capture that stayed an active
 * thought. Undefined = the forget request was not applied yet. A malformed marker throws.
 */
export function readForgetInstruction(
  metadata: Record<string, unknown>,
): ForgetInstructionMarker | undefined {
  const marker = metadata.forgetInstruction
  if (marker === undefined || marker === null) return undefined
  if (typeof marker !== 'object' || Array.isArray(marker)) {
    throw new Error('forgetInstruction marker is malformed: must be an object')
  }
  const { status, unresolved } = marker as { status?: unknown; unresolved?: unknown }
  if (!FORGET_INSTRUCTION_STATUSES.includes(status as ForgetInstructionStatus)) {
    throw new Error(
      `forgetInstruction marker is malformed: status must be one of ${FORGET_INSTRUCTION_STATUSES.join(' | ')}`,
    )
  }
  if (!Array.isArray(unresolved) || !unresolved.every(isUnresolvedForgetHit)) {
    throw new Error(
      'forgetInstruction marker is malformed: unresolved must be a list of {kind: thought | note, id}',
    )
  }
  return { status: status as ForgetInstructionStatus, unresolved }
}
