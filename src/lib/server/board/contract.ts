import { z } from 'zod'
import {
  BOARD_AREAS,
  BOARD_IDEA_STATUSES,
  BOARD_KINDS,
  BOARD_STATUSES,
  type MyVote,
} from '$lib/feedback/board-types'
import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'
import { BoardError } from './errors'

/**
 * Boundary contracts for the board endpoints and MCP tools. Everything is
 * validated here before any DB or LLM work; failures are 400 with the constraint.
 */

export const boardTitleSchema = z
  .string({ error: 'title must be a string' })
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, 'title must not be empty')
      .max(FEEDBACK_MAX_LENGTH, `title must be at most ${FEEDBACK_MAX_LENGTH} characters`),
  )

export const boardKindSchema = z.enum(BOARD_KINDS)
export const boardAreaSchema = z.enum(BOARD_AREAS)
export const boardStatusSchema = z.enum(BOARD_STATUSES)
export const boardIdeaStatusSchema = z.enum(BOARD_IDEA_STATUSES)

export const boardCheckBodySchema = z.object({ title: boardTitleSchema }).strict()

export const boardCreateBodySchema = z
  .object({ title: boardTitleSchema, kind: boardKindSchema, area: boardAreaSchema })
  .strict()

const authorPatchSchema = z
  .object({ kind: boardKindSchema.optional(), area: boardAreaSchema.optional() })
  .strict()

const adminPatchSchema = z
  .object({
    title: boardTitleSchema.optional(),
    status: boardIdeaStatusSchema.optional(),
    planned: z.boolean().optional(),
    note: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, 'note must not be empty (send null to clear it)').max(1000))
      .nullable()
      .optional(),
    hidden: z.boolean().optional(),
  })
  .strict()

export type BoardAuthorPatch = z.infer<typeof authorPatchSchema>
export type BoardAdminPatch = z.infer<typeof adminPatchSchema>
export type BoardPatch =
  { scope: 'author'; patch: BoardAuthorPatch } | { scope: 'admin'; patch: BoardAdminPatch }

const AUTHOR_KEYS = new Set(['kind', 'area'])
const ADMIN_KEYS = new Set(['title', 'status', 'planned', 'note', 'hidden'])

/** First zod issue as a plain sentence. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid body'
  const path = issue.path.join('.')
  return path && !issue.message.startsWith(path) ? `${path}: ${issue.message}` : issue.message
}

/**
 * One PATCH, two scopes: the author corrects kind/area (Requested only); the
 * makers change title/status/planned/note/hidden. Mixing them is ambiguous → 400.
 */
export function parseBoardPatch(body: unknown): BoardPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BoardError('Body must be a JSON object', 400)
  }
  const keys = Object.keys(body)
  if (keys.length === 0) throw new BoardError('Nothing to change', 400)
  const unknown = keys.find((k) => !AUTHOR_KEYS.has(k) && !ADMIN_KEYS.has(k))
  if (unknown) throw new BoardError(`Unknown field: ${unknown}`, 400)
  const author = keys.some((k) => AUTHOR_KEYS.has(k))
  const admin = keys.some((k) => ADMIN_KEYS.has(k))
  if (author && admin) {
    throw new BoardError(
      'Send either kind/area (author) or title/status/planned/note/hidden (makers), not both',
      400,
    )
  }
  const parsed = (author ? authorPatchSchema : adminPatchSchema).safeParse(body)
  if (!parsed.success) throw new BoardError(firstIssue(parsed.error), 400)
  return author
    ? { scope: 'author', patch: parsed.data as BoardAuthorPatch }
    : { scope: 'admin', patch: parsed.data as BoardAdminPatch }
}

/** -1, 0 (remove) or 1 — anything else fails loud with the constraint. */
export function parseVoteDirection(value: unknown): MyVote {
  if (value === -1 || value === 0 || value === 1) return value
  const shown = value === undefined ? 'undefined' : JSON.stringify(value)
  throw new BoardError(`Invalid direction: ${shown}. Must be -1, 0 or 1`, 400)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Format validation for idea ids (UUID). */
export function parseIdeaId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!UUID.test(id)) {
    throw new BoardError(`Invalid idea_id: ${JSON.stringify(value ?? null)}. Must be a UUID`, 400)
  }
  return id.toLowerCase()
}
