import type { BoardAdminPatch, BoardAuthorPatch } from './contract'
import type { BoardJudgeCandidate } from './judge'
import { and, eq, sql } from 'drizzle-orm'
import type {
  BoardIdea,
  BoardKind,
  BoardArea,
  MyVote,
  BoardStatus,
} from '$lib/feedback/board-types'
import { getDb } from '$lib/server/db'
import { user } from '$lib/server/db/auth.schema'
import { boardIdea, boardVote, feedback } from '$lib/server/db/brain.schema'
import { rowsFromDbExecute } from '$lib/server/db/execute-rows'
import { formatAuthorDisplay } from './author-display'
import { BoardError } from './errors'

/**
 * Board persistence. Every query runs on the request's tenant session (RLS on):
 * ideas are a shared read, votes are owner-only, scores come from the
 * `board_scores()` aggregate, makers' changes go through `board_admin_update()`.
 * `title_embedding` is never selected for anything that leaves this module.
 */

const EMBEDDING_DIMENSIONS = 1536

type ListRow = {
  id: string
  title: string
  kind: BoardKind
  area: BoardArea
  status: BoardStatus
  planned: boolean
  maker_note: string | null
  created_at: Date | string
  shipped_at: Date | string | null
  author_user_id: string | null
  first_name: string | null
  last_name: string | null
  author_name: string | null
  score: number | string | null
  my_vote: number | string | null
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function toMyVote(value: number | string | null): MyVote {
  const n = Number(value ?? 0)
  return n === 1 ? 1 : n === -1 ? -1 : 0
}

function toView(row: ListRow, userId: string): BoardIdea {
  const isYou = row.author_user_id === userId
  const display =
    row.author_user_id === null
      ? null
      : formatAuthorDisplay({
          firstName: row.first_name,
          lastName: row.last_name,
          name: row.author_name,
        })
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    area: row.area,
    status: row.status,
    planned: row.planned,
    note: row.maker_note,
    score: Number(row.score ?? 0),
    myVote: toMyVote(row.my_vote),
    author: display ? { display, isYou } : null,
    createdAt: iso(row.created_at)!,
    shippedAt: iso(row.shipped_at),
    own: isYou,
  }
}

async function selectIdeas(userId: string, ideaId?: string): Promise<BoardIdea[]> {
  const result = await getDb().execute(sql`
    SELECT i.id, i.title, i.kind, i.area, i.status, i.planned, i.maker_note,
           i.created_at, i.shipped_at, i.author_user_id,
           u.first_name, u.last_name, u.name AS author_name,
           coalesce(s.score, 0) AS score,
           coalesce(v.direction, 0) AS my_vote
    FROM board_idea i
    LEFT JOIN "user" u ON u.id = i.author_user_id
    LEFT JOIN board_scores() s ON s.idea_id = i.id
    LEFT JOIN board_vote v ON v.idea_id = i.id AND v.user_id = ${userId}
    WHERE i.hidden = false ${ideaId ? sql`AND i.id = ${ideaId}` : sql``}
    ORDER BY i.created_at DESC
  `)
  return rowsFromDbExecute<ListRow>(result).map((row) => toView(row, userId))
}

/** MB-3: the whole shared board as `userId` sees it. */
export function listBoardIdeas(userId: string): Promise<BoardIdea[]> {
  return selectIdeas(userId)
}

export async function getBoardIdea(userId: string, ideaId: string): Promise<BoardIdea | null> {
  return (await selectIdeas(userId, ideaId))[0] ?? null
}

function toVectorSql(vector: readonly number[]) {
  if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every((n) => Number.isFinite(n))) {
    throw new Error(`Invalid title embedding: expected ${EMBEDDING_DIMENSIONS} finite numbers`)
  }
  return sql`${`[${vector.join(',')}]`}::vector`
}

/** Open ideas ranked by title-embedding similarity — candidates for the judge, not a decision. */
export async function findDuplicateCandidates(
  embedding: readonly number[],
  limit: number,
): Promise<BoardJudgeCandidate[]> {
  const vec = toVectorSql(embedding)
  const rows = await getDb()
    .select({
      id: boardIdea.id,
      title: boardIdea.title,
      kind: boardIdea.kind,
      area: boardIdea.area,
      status: boardIdea.status,
    })
    .from(boardIdea)
    .where(
      and(
        eq(boardIdea.hidden, false),
        sql`${boardIdea.status} NOT IN ('shipped', 'rejected')`,
        sql`${boardIdea.titleEmbedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${boardIdea.titleEmbedding} <=> ${vec}`)
    .limit(Math.max(1, Math.min(limit, 20)))
  return rows.flatMap((row) => (row.status === 'rejected' ? [] : [{ ...row, status: row.status }]))
}

export async function loadUserEmail(userId: string): Promise<string> {
  const [row] = await getDb()
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const email = row?.email?.trim()
  if (!email) throw new Error('Authenticated user has no email address')
  return email
}

/**
 * MB-4 + D2: one transaction — the inbox row, the idea (Requested), and the
 * author's own +1.
 */
export async function insertBoardIdea(input: {
  userId: string
  title: string
  kind: BoardKind
  area: BoardArea
  embedding: readonly number[]
}): Promise<{ ideaId: string; feedbackId: string }> {
  toVectorSql(input.embedding) // validates dimensions before any write
  return getDb().transaction(async (tx) => {
    const [fb] = await tx
      .insert(feedback)
      .values({
        userId: input.userId,
        message: `[board ${input.kind} · ${input.area}] ${input.title}`,
      })
      .returning({ id: feedback.id })
    const [idea] = await tx
      .insert(boardIdea)
      .values({
        authorUserId: input.userId,
        title: input.title,
        kind: input.kind,
        area: input.area,
        titleEmbedding: [...input.embedding],
        feedbackId: fb.id,
      })
      .returning({ id: boardIdea.id })
    await tx.insert(boardVote).values({ ideaId: idea.id, userId: input.userId, direction: 1 })
    return { ideaId: idea.id, feedbackId: fb.id }
  })
}

async function loadForWrite(ideaId: string) {
  const [row] = await getDb()
    .select({ id: boardIdea.id, authorUserId: boardIdea.authorUserId, status: boardIdea.status })
    .from(boardIdea)
    .where(eq(boardIdea.id, ideaId))
    .limit(1)
  if (!row) throw new BoardError('Idea not found', 404)
  return row
}

async function assertAuthorRequested(userId: string, ideaId: string, verb: string) {
  const row = await loadForWrite(ideaId)
  if (row.authorUserId !== userId)
    throw new BoardError(`Only the author can ${verb} this idea`, 403)
  if (row.status !== 'requested') {
    throw new BoardError(
      `Only Requested ideas can be ${verb === 'forget' ? 'forgotten' : 'changed'}`,
      409,
    )
  }
}

/** D5: the author corrects the judge's kind/area while the idea is Requested. */
export async function correctBoardIdea(
  userId: string,
  ideaId: string,
  patch: BoardAuthorPatch,
): Promise<void> {
  await assertAuthorRequested(userId, ideaId, 'change')
  const updated = await getDb()
    .update(boardIdea)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(boardIdea.id, ideaId),
        eq(boardIdea.authorUserId, userId),
        eq(boardIdea.status, 'requested'),
      ),
    )
    .returning({ id: boardIdea.id })
  if (updated.length === 0) throw new BoardError('Only Requested ideas can be changed', 409)
}

/** MB-6: "Forget" — author only, Requested only; votes go with it (FK cascade). */
export async function deleteBoardIdea(userId: string, ideaId: string): Promise<void> {
  await assertAuthorRequested(userId, ideaId, 'forget')
  const deleted = await getDb()
    .delete(boardIdea)
    .where(
      and(
        eq(boardIdea.id, ideaId),
        eq(boardIdea.authorUserId, userId),
        eq(boardIdea.status, 'requested'),
      ),
    )
    .returning({ id: boardIdea.id })
  if (deleted.length === 0) throw new BoardError('Only Requested ideas can be forgotten', 409)
}

async function scoreOf(ideaId: string): Promise<number> {
  const result = await getDb().execute(
    sql`SELECT score FROM board_scores() WHERE idea_id = ${ideaId}`,
  )
  return Number(rowsFromDbExecute<{ score: number }>(result)[0]?.score ?? 0)
}

/** MB-2: upsert on (idea, user); 0 removes. Last write wins on double taps. */
export async function setBoardVote(
  userId: string,
  ideaId: string,
  direction: MyVote,
): Promise<{ score: number; myVote: MyVote }> {
  const row = await loadForWrite(ideaId)
  if (row.status === 'shipped')
    throw new BoardError('This idea has shipped — votes are closed', 409)
  if (row.authorUserId === userId && direction === -1) {
    throw new BoardError('You can’t vote your own idea down — take your vote back instead', 409)
  }
  const db = getDb()
  if (direction === 0) {
    await db
      .delete(boardVote)
      .where(and(eq(boardVote.ideaId, ideaId), eq(boardVote.userId, userId)))
  } else {
    await db
      .insert(boardVote)
      .values({ ideaId, userId, direction })
      .onConflictDoUpdate({
        target: [boardVote.ideaId, boardVote.userId],
        set: { direction, updatedAt: new Date() },
      })
  }
  return { score: await scoreOf(ideaId), myVote: direction }
}

function pgCode(err: unknown): string | undefined {
  for (let cur: unknown = err, depth = 0; cur && depth < 4; depth++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string') return code
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}

/** MB-5: makers' controls through the SECURITY DEFINER function (role checked in SQL too). */
export async function adminUpdateBoardIdea(
  userId: string,
  ideaId: string,
  patch: BoardAdminPatch,
): Promise<void> {
  void userId
  const note = patch.note === undefined || patch.note === null ? null : patch.note
  const clearNote = patch.note === null
  let found: boolean
  try {
    const result = await getDb().execute(sql`
      SELECT board_admin_update(
        ${ideaId}::uuid,
        ${patch.status ?? null}::text,
        ${patch.planned ?? null}::boolean,
        ${note}::text,
        ${clearNote}::boolean,
        ${patch.hidden ?? null}::boolean
      ) AS found
    `)
    found = Boolean(rowsFromDbExecute<{ found: boolean }>(result)[0]?.found)
  } catch (err) {
    if (pgCode(err) === '42501')
      throw new BoardError('Only the makers can change status, notes or visibility', 403)
    throw err
  }
  if (!found) throw new BoardError('Idea not found', 404)
}
