/**
 * Injects one mistake into a captured thought's stored data, at exactly the source the capture audit
 * reads (`loadCaptureAuditInput`, docs/planning/capture-feedback.md C1): the thought's
 * `temporal_event` rows, the `entity_resolution_log` surfaces, the stored normalized text and
 * `metadata.splitInto`. Texts and metadata are written in the form the pipeline writes them (the
 * encrypted column when the row has one, plus the plaintext mirror the pipeline keeps).
 *
 * Writes go through the operator connection (`withOperatorDb`, no tenant session), so every
 * statement names the tenant user id and must hit a row: a statement that changed nothing throws
 * (row-level security or a wrong id would otherwise let the injection silently not happen).
 *
 * Live only (needs the database): the descriptors and their judgments are in verify-mutations.ts
 * and verify-judge.ts and are unit-tested; this file has no test and is exercised by the run.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { CaptureAuditInput } from '$lib/server/capture-review/audit-questions'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import type { AppDatabase } from '$lib/server/db'
import { captureReview, entityResolutionLog, temporalEvent, thought } from '$lib/server/db/schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { withEvalDb, withOperatorDb } from '../harness/eval-context'
import {
  PieceMutationError,
  withFragmentPiece,
  withoutLastPiece,
  type Mutation,
} from './verify-mutations'

/** A stored precondition for the mutation did not hold (e.g. the capture has no dates to shift). */
export class InjectionSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InjectionSetupError'
  }
}

export type InjectionResult = {
  /** The exact part ref the mutation targets, or null for a whole-capture part. */
  targetRef: string | null
  /** Plain facts about what was injected, for the report (the made-up fixture's own strings). */
  notes?: string[]
}

/**
 * The tenant's data key is read through the tenant session, so encryption and decryption run in one
 * (the operator connection has no tenant context); the row writes stay on the operator connection.
 */
const encryptForTenant = (input: Parameters<typeof encryptTenantValue>[0]) =>
  withEvalDb(input.userId, () => encryptTenantValue(input))
const decryptForTenant = (input: Parameters<typeof decryptTenantValue>[0]) =>
  withEvalDb(input.userId, () => decryptTenantValue(input))

type AuditView = () => Promise<CaptureAuditInput | null>

function requireRows(rows: unknown[], what: string): void {
  if (rows.length === 0) throw new Error(`[capture-review] injection changed nothing: ${what}`)
}

async function storedEvents(db: AppDatabase, userId: string, thoughtId: string) {
  return db
    .select({
      id: temporalEvent.id,
      timePrecision: temporalEvent.timePrecision,
      isAllDay: temporalEvent.isAllDay,
    })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, thoughtId)))
    .orderBy(asc(temporalEvent.startAt), asc(temporalEvent.id))
}

async function shiftEvent(
  db: AppDatabase,
  input: {
    userId: string
    thoughtId: string
    interval: ReturnType<typeof sql>
    needsClock: boolean
  },
): Promise<InjectionResult> {
  const events = await storedEvents(db, input.userId, input.thoughtId)
  if (events.length !== 1) {
    throw new InjectionSetupError(
      `the capture has ${events.length} stored dates; the shift needs exactly 1`,
    )
  }
  const [event] = events
  if (input.needsClock && (event.timePrecision !== 'exact' || event.isAllDay)) {
    throw new InjectionSetupError('the stored date has no clock time to change')
  }
  const rows = await db
    .update(temporalEvent)
    .set({
      activePeriod: sql`tsrange(lower(${temporalEvent.activePeriod}) + ${input.interval}, upper(${temporalEvent.activePeriod}) + ${input.interval}, '[)')`,
      startAt: sql`${temporalEvent.startAt} + ${input.interval}`,
      endAt: sql`${temporalEvent.endAt} + ${input.interval}`,
    })
    .where(and(eq(temporalEvent.userId, input.userId), eq(temporalEvent.id, event.id)))
    .returning({ id: temporalEvent.id })
  requireRows(rows, 'temporal_event shift')
  return { targetRef: 'date:d1' }
}

async function readMetadata(
  db: AppDatabase,
  userId: string,
  thoughtId: string,
): Promise<{ metadata: Record<string, unknown>; encrypted: boolean }> {
  const [row] = await db
    .select({ metadata: thought.metadata, metadataEncrypted: thought.metadataEncrypted })
    .from(thought)
    .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
    .limit(1)
  if (!row) throw new Error('[capture-review] injection: the thought does not exist')
  if (row.metadataEncrypted) {
    const json = await decryptForTenant({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: row.metadataEncrypted,
    })
    return { metadata: JSON.parse(json) as Record<string, unknown>, encrypted: true }
  }
  return { metadata: row.metadata ?? {}, encrypted: false }
}

async function writeSplitInto(
  db: AppDatabase,
  input: {
    userId: string
    thoughtId: string
    pieces: string[]
    encrypted: boolean
    metadata: Record<string, unknown>
  },
): Promise<void> {
  const next = { ...input.metadata, splitInto: input.pieces }
  const set = input.encrypted
    ? {
        metadataEncrypted: await encryptForTenant({
          userId: input.userId,
          table: 'thought',
          column: 'metadata',
          plaintext: JSON.stringify(next),
        }),
      }
    : { metadata: next }
  const rows = await db
    .update(thought)
    .set(set)
    .where(and(eq(thought.userId, input.userId), eq(thought.id, input.thoughtId)))
    .returning({ id: thought.id })
  requireRows(rows, 'thought.metadata')
}

async function storedPieces(
  db: AppDatabase,
  userId: string,
  thoughtId: string,
): Promise<{ pieces: string[]; metadata: Record<string, unknown>; encrypted: boolean }> {
  const { metadata, encrypted } = await readMetadata(db, userId, thoughtId)
  const splitInto = metadata.splitInto
  if (!Array.isArray(splitInto) || splitInto.some((p) => typeof p !== 'string')) {
    throw new InjectionSetupError('the capture was not split: metadata.splitInto is missing')
  }
  return { pieces: splitInto as string[], metadata, encrypted }
}

/** Applies `mutation` to the stored data of `thoughtId`. Throws `InjectionSetupError` when the stored data cannot take it. */
export async function injectMutation(input: {
  userId: string
  thoughtId: string
  mutation: Mutation
  /** Reads the audit input the audit would see now (tenant session). */
  auditView: AuditView
  /** Name refs (`n1`, ...) of the clean audit, the one Jev was surest about first. */
  rankedNameRefs: string[]
}): Promise<InjectionResult> {
  const { userId, thoughtId, mutation } = input
  try {
    return await withOperatorDb(async (db) => {
      switch (mutation.type) {
        case 'shift_date':
          return shiftEvent(db, {
            userId,
            thoughtId,
            interval: sql`make_interval(days => ${mutation.days})`,
            needsClock: false,
          })
        case 'shift_time':
          return shiftEvent(db, {
            userId,
            thoughtId,
            interval: sql`make_interval(hours => ${mutation.hours})`,
            needsClock: true,
          })
        case 'delete_dates': {
          const rows = await db
            .delete(temporalEvent)
            .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, thoughtId)))
            .returning({ id: temporalEvent.id })
          if (rows.length === 0)
            throw new InjectionSetupError('the capture has no stored dates to delete')
          return { targetRef: null }
        }
        case 'add_name': {
          const [template] = await db
            .select({
              decision: entityResolutionLog.decision,
              confidence: entityResolutionLog.confidence,
            })
            .from(entityResolutionLog)
            .where(
              and(
                eq(entityResolutionLog.userId, userId),
                eq(entityResolutionLog.thoughtId, thoughtId),
              ),
            )
            .orderBy(asc(entityResolutionLog.createdAt), asc(entityResolutionLog.id))
            .limit(1)
          if (!template)
            throw new InjectionSetupError('the capture has no logged names to copy the shape of')
          const rows = await db
            .insert(entityResolutionLog)
            .values({
              userId,
              thoughtId,
              mentionSurface: mutation.surface.trim(),
              canonicalEntityId: null,
              decision: template.decision,
              confidence: template.confidence,
              metadata: {},
            })
            .returning({ id: entityResolutionLog.id })
          requireRows(rows, 'entity_resolution_log insert')
          const view = await input.auditView()
          const injected = view?.names.find((n) => n.surface === mutation.surface.trim())
          if (!injected)
            throw new Error(
              '[capture-review] injection: the invented name is not in the audit input',
            )
          return { targetRef: `name:${injected.ref}` }
        }
        case 'remove_name': {
          const before = await input.auditView()
          if (!before) throw new Error('[capture-review] injection: the thought does not exist')
          // The name Jev rated most surely a real name of the capture goes: removing a junk name would
          // leave nothing missing. This uses Jev's own ratings from the clean audit, no text rule.
          const surface = input.rankedNameRefs
            .map((ref) => before.names.find((n) => n.ref === ref)?.surface)
            .find((s): s is string => s !== undefined)
          if (surface === undefined) {
            throw new InjectionSetupError('the audit rated no found name, so none can be removed')
          }
          const logged = await db
            .select({ id: entityResolutionLog.id, surface: entityResolutionLog.mentionSurface })
            .from(entityResolutionLog)
            .where(
              and(
                eq(entityResolutionLog.userId, userId),
                eq(entityResolutionLog.thoughtId, thoughtId),
              ),
            )
          const ids = logged.filter((r) => r.surface.trim() === surface).map((r) => r.id)
          if (ids.length === 0) {
            throw new InjectionSetupError(
              'the best-rated name comes from a project link, not from the resolution log',
            )
          }
          const rows = await db
            .delete(entityResolutionLog)
            .where(
              and(eq(entityResolutionLog.userId, userId), inArray(entityResolutionLog.id, ids)),
            )
            .returning({ id: entityResolutionLog.id })
          requireRows(rows, 'entity_resolution_log delete')
          const after = await input.auditView()
          if (!after || after.names.some((n) => n.surface === surface)) {
            throw new InjectionSetupError(
              'the removed name is still in the audit input (another source lists it too)',
            )
          }
          return {
            targetRef: null,
            notes: [
              `removed the name "${surface}"; names left: ${after.names.map((n) => `"${n.surface}"`).join(', ') || 'none'}`,
            ],
          }
        }
        case 'replace_wording': {
          const [row] = await db
            .select({ encrypted: thought.normalizedTextEncrypted })
            .from(thought)
            .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
            .limit(1)
          if (!row) throw new Error('[capture-review] injection: the thought does not exist')
          const text = mutation.text.trim()
          const rows = await db
            .update(thought)
            .set({
              normalizedText: text,
              lexicalText: computeLexicalText(text),
              ...(row.encrypted
                ? {
                    normalizedTextEncrypted: await encryptForTenant({
                      userId,
                      table: 'thought',
                      column: 'normalized_text',
                      plaintext: text,
                    }),
                  }
                : {}),
            })
            .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
            .returning({ id: thought.id })
          requireRows(rows, 'thought.normalized_text')
          return { targetRef: null }
        }
        case 'fragment_piece': {
          const stored = await storedPieces(db, userId, thoughtId)
          const pieces = withFragmentPiece(stored.pieces, mutation.piece)
          await writeSplitInto(db, {
            userId,
            thoughtId,
            pieces,
            encrypted: stored.encrypted,
            metadata: stored.metadata,
          })
          return {
            targetRef: `piece:p${mutation.piece}`,
            notes: [
              `pieces were ${stored.pieces.map((p) => `"${p}"`).join(', ')}; piece ${mutation.piece} is now "${pieces[mutation.piece - 1]}"`,
            ],
          }
        }
        case 'drop_last_piece': {
          const stored = await storedPieces(db, userId, thoughtId)
          const pieces = withoutLastPiece(stored.pieces)
          await writeSplitInto(db, {
            userId,
            thoughtId,
            pieces,
            encrypted: stored.encrypted,
            metadata: stored.metadata,
          })
          return {
            targetRef: null,
            notes: [
              `pieces were ${stored.pieces.map((p) => `"${p}"`).join(', ')}; dropped "${stored.pieces[stored.pieces.length - 1]}"`,
            ],
          }
        }
      }
    })
  } catch (err) {
    if (err instanceof PieceMutationError) throw new InjectionSetupError(err.message)
    throw err
  }
}

/** Puts the review back to `pending_audit` (parts kept) so the audit can score the injected data. */
export async function resetReviewForReaudit(input: {
  userId: string
  thoughtId: string
}): Promise<void> {
  await withOperatorDb(async (db) => {
    const rows = await db
      .update(captureReview)
      .set({ status: 'pending_audit', score: null, auditError: null, updatedAt: new Date() })
      .where(
        and(eq(captureReview.userId, input.userId), eq(captureReview.thoughtId, input.thoughtId)),
      )
      .returning({ id: captureReview.id })
    requireRows(rows, 'capture_review reset')
  })
}
