import { z } from 'zod'
import type { ReviewAuditPart } from '$lib/server/capture-review/review-parts'

/**
 * The mistakes `npm run capture-review:verify` injects into a capture's stored data, as pure
 * descriptors (docs/planning/capture-feedback.md, C5). A descriptor is generic: it says WHICH kind
 * of stored thing to damage and by how much, never anything about a capture's text. The live runner
 * (run-verify.ts) applies it at the source the audit reads; the table below says which audit part
 * must notice.
 */

const nonBlank = z.string().refine((s) => s.trim() !== '', 'must not be blank')

export const mutationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('shift_date'),
    days: z
      .number()
      .int()
      .refine((n) => n !== 0, 'days must not be 0'),
  }),
  z.strictObject({
    type: z.literal('shift_time'),
    hours: z
      .number()
      .int()
      .min(-23)
      .max(23)
      .refine((n) => n !== 0, 'hours must not be 0'),
  }),
  z.strictObject({ type: z.literal('delete_dates') }),
  z.strictObject({ type: z.literal('add_name'), surface: nonBlank }),
  z.strictObject({ type: z.literal('remove_name') }),
  z.strictObject({ type: z.literal('replace_wording'), text: nonBlank }),
  z.strictObject({ type: z.literal('fragment_piece'), piece: z.number().int().min(1) }),
  z.strictObject({ type: z.literal('drop_last_piece') }),
])

export type Mutation = z.infer<typeof mutationSchema>

export type NegativeLabel = 'wrong' | 'something_missing'

/** The audit part that must flip, and the label that means it did. */
export function mutationTarget(m: Mutation): {
  part: ReviewAuditPart
  negativeLabel: NegativeLabel
} {
  switch (m.type) {
    case 'shift_date':
    case 'shift_time':
      return { part: 'date', negativeLabel: 'wrong' }
    case 'delete_dates':
      return { part: 'missing_dates', negativeLabel: 'something_missing' }
    case 'add_name':
      return { part: 'name', negativeLabel: 'wrong' }
    case 'remove_name':
      return { part: 'missing_names', negativeLabel: 'something_missing' }
    case 'replace_wording':
      return { part: 'wording', negativeLabel: 'wrong' }
    case 'fragment_piece':
      return { part: 'piece', negativeLabel: 'wrong' }
    case 'drop_last_piece':
      return { part: 'pieces_cover', negativeLabel: 'wrong' }
  }
}

/** A short label for the report table. Holds no capture text and no injected value. */
export function describeMutation(m: Mutation): string {
  switch (m.type) {
    case 'shift_date':
      return `date ${m.days > 0 ? '+' : ''}${m.days} ${Math.abs(m.days) === 1 ? 'day' : 'days'}`
    case 'shift_time':
      return `time ${m.hours > 0 ? '+' : ''}${m.hours} h`
    case 'delete_dates':
      return 'dates deleted'
    case 'add_name':
      return 'name invented'
    case 'remove_name':
      return 'name removed'
    case 'replace_wording':
      return 'wording changed'
    case 'fragment_piece':
      return `piece ${m.piece} cut to a fragment`
    case 'drop_last_piece':
      return 'last piece dropped'
  }
}

/** The stored pieces cannot take this mutation (too few, too short). A setup failure, not a bug. */
export class PieceMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PieceMutationError'
  }
}

const MIN_WORDS_TO_CUT = 3

/**
 * The first half of a piece's words (rounded up): a fragment that stops mid-sentence. A mechanical
 * cut for building the injected mistake; it does not judge anything about the text.
 */
export function fragmentOfPiece(text: string): string {
  const words = text.trim().split(/\s+/)
  if (words.length < MIN_WORDS_TO_CUT) {
    throw new PieceMutationError(`a piece needs at least ${MIN_WORDS_TO_CUT} words to be cut`)
  }
  return words.slice(0, Math.ceil(words.length / 2)).join(' ')
}

/** `pieces` with piece number `piece` (1-based) cut to a fragment. */
export function withFragmentPiece(pieces: string[], piece: number): string[] {
  if (piece < 1 || piece > pieces.length) {
    throw new PieceMutationError(`piece ${piece} does not exist (the capture has ${pieces.length})`)
  }
  return pieces.map((text, i) => (i === piece - 1 ? fragmentOfPiece(text) : text))
}

/** `pieces` without the last one; the capture needs at least two for a piece to be lost. */
export function withoutLastPiece(pieces: string[]): string[] {
  if (pieces.length < 2) {
    throw new PieceMutationError(
      `dropping a piece needs at least 2 pieces (the capture has ${pieces.length})`,
    )
  }
  return pieces.slice(0, -1)
}
