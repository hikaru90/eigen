import type { NowCardPayload } from './now-store'
import { and, count, desc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { canonicalEntity, nowCard, thoughtEntity, type NowCardKind } from '$lib/server/db/schema'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'

/**
 * History of answered Now cards (docs/planning/feature-mesh-now.md, NOW-14). Read-only, no LLM.
 * An undone card is `pending` again, so it is not here; `superseded` and `expired` cards were
 * never answered.
 */

const TABLE = 'now_card'

export const NOW_HISTORY_PAGE_SIZE = 50

/** Answers whose past-tense line names a project. */
const NAMES_PROJECT = ['yes', 'other_project', 'something_else', 'someday', 'finished']

export type NowHistoryItem = {
  cardId: string
  kind: NowCardKind
  text: string
  answer: string
  projectLabel: string | null
  answeredAt: string
  thoughtId: string | null
}

export type NowHistoryPage = { items: NowHistoryItem[]; nextCursor: string | null }

export class NowHistoryCursorError extends Error {
  constructor() {
    super('before is not a cursor from this endpoint')
    this.name = 'NowHistoryCursorError'
  }
}

type Cursor = { answeredAt: Date; id: string }

function encodeCursor(answeredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([answeredAt.toISOString(), id])).toString('base64url')
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [iso, id] = parsed
      const answeredAt = new Date(iso)
      if (typeof iso === 'string' && typeof id === 'string' && !Number.isNaN(answeredAt.getTime())) {
        return { answeredAt, id }
      }
    }
  } catch {
    // falls through to the one error below
  }
  throw new NowHistoryCursorError()
}

export async function loadNowHistory(
  userId: string,
  opts: { before?: string },
): Promise<NowHistoryPage> {
  const cursor = opts.before === undefined ? null : decodeCursor(opts.before)
  const db = getDb()

  const rows = await db
    .select({
      id: nowCard.id,
      kind: nowCard.kind,
      answer: nowCard.answer,
      answeredAt: nowCard.answeredAt,
      targetThoughtId: nowCard.targetThoughtId,
      targetProjectEntityId: nowCard.targetProjectEntityId,
      payloadEncrypted: nowCard.payloadEncrypted,
    })
    .from(nowCard)
    .where(
      and(
        eq(nowCard.userId, userId),
        eq(nowCard.status, 'answered'),
        isNotNull(nowCard.answeredAt),
        ...(cursor
          ? [
              or(
                lt(nowCard.answeredAt, cursor.answeredAt),
                and(eq(nowCard.answeredAt, cursor.answeredAt), lt(nowCard.id, cursor.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(nowCard.answeredAt), desc(nowCard.id))
    .limit(NOW_HISTORY_PAGE_SIZE + 1)

  const page = rows.slice(0, NOW_HISTORY_PAGE_SIZE)
  const named = page.filter((r) => r.answer !== null && NAMES_PROJECT.includes(r.answer))

  const projectIds = [
    ...new Set(
      named
        .filter((r) => r.answer !== 'other_project' && r.targetProjectEntityId)
        .map((r) => r.targetProjectEntityId as string),
    ),
  ]
  const movedThoughtIds = [
    ...new Set(
      named
        .filter((r) => r.answer === 'other_project' && r.targetThoughtId)
        .map((r) => r.targetThoughtId as string),
    ),
  ]

  const [projectRows, memberRows] = await Promise.all([
    projectIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; label: string }>)
      : db
          .select({ id: canonicalEntity.id, label: canonicalEntity.label })
          .from(canonicalEntity)
          .where(and(eq(canonicalEntity.userId, userId), inArray(canonicalEntity.id, projectIds))),
    movedThoughtIds.length === 0
      ? Promise.resolve([] as Array<{ thoughtId: string; label: string }>)
      : db
          .select({ thoughtId: thoughtEntity.thoughtId, label: canonicalEntity.label })
          .from(thoughtEntity)
          .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
          .where(
            and(
              eq(thoughtEntity.userId, userId),
              inArray(thoughtEntity.thoughtId, movedThoughtIds),
              projectMembershipLinkCondition(),
              isNotNull(canonicalEntity.projectStatus),
            ),
          ),
  ])
  const labelByProject = new Map(projectRows.map((p) => [p.id, p.label]))
  const labelByThought = new Map(memberRows.map((p) => [p.thoughtId, p.label]))

  const items = await Promise.all(
    page.map(async (r): Promise<NowHistoryItem> => {
      const payload = JSON.parse(
        await decryptTenantValue({
          userId,
          table: TABLE,
          column: 'payload',
          ciphertext: r.payloadEncrypted,
        }),
      ) as NowCardPayload
      const answer = r.answer as string
      let projectLabel: string | null = null
      if (NAMES_PROJECT.includes(answer)) {
        projectLabel =
          answer === 'other_project'
            ? (r.targetThoughtId ? labelByThought.get(r.targetThoughtId) : undefined) ?? null
            : (r.targetProjectEntityId ? labelByProject.get(r.targetProjectEntityId) : undefined) ??
              null
      }
      return {
        cardId: r.id,
        kind: r.kind,
        text: payload.text,
        answer,
        projectLabel,
        answeredAt: (r.answeredAt as Date).toISOString(),
        thoughtId: r.targetThoughtId,
      }
    }),
  )

  const last = page.at(-1)
  return {
    items,
    nextCursor:
      rows.length > NOW_HISTORY_PAGE_SIZE && last
        ? encodeCursor(last.answeredAt as Date, last.id)
        : null,
  }
}

export async function countNowHistory(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(nowCard)
    .where(and(eq(nowCard.userId, userId), eq(nowCard.status, 'answered')))
  return row?.n ?? 0
}
