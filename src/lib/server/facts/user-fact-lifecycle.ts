/**
 * Lifecycle of stored facts (docs/planning/user-facts-layer.md): a fact lives as long as one of the
 * things it was derived from lives, and a forget request removes it directly.
 *
 *   release          the thought is re-derived (enrichment retry, edit): its source links go, facts
 *                    nothing else carries are retired
 *   archive hooks    a source thought / note was archived: facts with no live source left are retired
 *   forgetUserFacts  S2b `remove_all` on a fact hit
 *
 * Retired = status `forgotten`: gone from every search immediately, and the secure value an
 * identifier fact pointed at is deleted with it. Which facts go is `planFactRetirement` (pure);
 * this module loads the rows and applies the plan. A source going away reopens the fact the retired
 * one had replaced; a forget request never does.
 */

import { and, eq, inArray, ne } from 'drizzle-orm'
import { getDb, type AppDatabase } from '$lib/server/db'
import { textFile, thought, userFact, userFactSource, userSecureValue } from '$lib/server/db/schema'
import { planFactRetirement } from './plan-fact-retirement'

/** Drizzle handle: the app db or a transaction on it. */
export type FactDbHandle = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>

/** A source row with the state of the thought / note it points at. */
export type FactSourceState = {
  factId: string
  thoughtId: string | null
  textFileId: string | null
  thoughtLifecycle: string | null
  fileId: string | null
  fileArchivedAt: Date | null
}

/**
 * A source lives while its thought is not archived (a completed thought is still remembered) or
 * its note exists and is not archived. A fact derived from a thought AND its note lives while
 * either does.
 */
export function sourceIsLive(source: FactSourceState): boolean {
  const thoughtLive =
    source.thoughtId !== null &&
    source.thoughtLifecycle !== null &&
    source.thoughtLifecycle !== 'archived'
  const noteLive =
    source.textFileId !== null && source.fileId !== null && source.fileArchivedAt === null
  return thoughtLive || noteLive
}

export type RetireOutcome = { retired: string[]; revived: string[] }

/** Retires every fact among `factIds` that no longer has a live source. */
export async function retireFactsWithoutLiveSource(
  userId: string,
  factIds: string[],
  options: { revive: boolean },
  db: FactDbHandle = getDb(),
): Promise<RetireOutcome> {
  const ids = [...new Set(factIds)]
  if (ids.length === 0) return { retired: [], revived: [] }

  const facts = await db
    .select({
      id: userFact.id,
      status: userFact.status,
      secureValueId: userFact.secureValueId,
      supersededBy: userFact.supersededBy,
    })
    .from(userFact)
    .where(and(eq(userFact.userId, userId), inArray(userFact.id, ids)))

  const sourceRows = await db
    .select({
      factId: userFactSource.factId,
      thoughtId: userFactSource.thoughtId,
      textFileId: userFactSource.textFileId,
      thoughtLifecycle: thought.lifecycleStatus,
      fileId: textFile.id,
      fileArchivedAt: textFile.archivedAt,
    })
    .from(userFactSource)
    .leftJoin(thought, eq(userFactSource.thoughtId, thought.id))
    .leftJoin(textFile, eq(userFactSource.textFileId, textFile.id))
    .where(and(eq(userFactSource.userId, userId), inArray(userFactSource.factId, ids)))

  const supersededByCandidates = options.revive
    ? await db
        .select({
          id: userFact.id,
          status: userFact.status,
          secureValueId: userFact.secureValueId,
          supersededBy: userFact.supersededBy,
        })
        .from(userFact)
        .where(and(eq(userFact.userId, userId), inArray(userFact.supersededBy, ids)))
    : []

  const plan = planFactRetirement({
    facts,
    sources: sourceRows.map((row) => ({ factId: row.factId, live: sourceIsLive(row) })),
    supersededByCandidates,
    revive: options.revive,
  })

  if (plan.retire.length > 0) {
    await db
      .update(userFact)
      .set({ status: 'forgotten', updatedAt: new Date() })
      .where(and(eq(userFact.userId, userId), inArray(userFact.id, plan.retire)))
  }
  if (plan.secureValueIds.length > 0) {
    // the facts' secure_value_id is cleared by the foreign key (ON DELETE SET NULL)
    await db
      .delete(userSecureValue)
      .where(
        and(eq(userSecureValue.userId, userId), inArray(userSecureValue.id, plan.secureValueIds)),
      )
  }
  if (plan.revive.length > 0) {
    await db
      .update(userFact)
      .set({ status: 'active', supersededBy: null, updatedAt: new Date() })
      .where(and(eq(userFact.userId, userId), inArray(userFact.id, plan.revive)))
  }
  return { retired: plan.retire, revived: plan.revive }
}

async function factIdsOfSource(
  db: FactDbHandle,
  userId: string,
  source: { thoughtId: string } | { textFileId: string },
): Promise<string[]> {
  const rows = await db
    .select({ factId: userFactSource.factId })
    .from(userFactSource)
    .where(
      and(
        eq(userFactSource.userId, userId),
        'thoughtId' in source
          ? eq(userFactSource.thoughtId, source.thoughtId)
          : eq(userFactSource.textFileId, source.textFileId),
      ),
    )
  return [...new Set(rows.map((r) => r.factId))]
}

/**
 * A thought is about to be derived again (enrichment retry, or its text was edited): drop it as a
 * source and retire the facts nothing else carries. What other captures or notes still say stays.
 */
export async function releaseThoughtFacts(userId: string, thoughtId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const factIds = await factIdsOfSource(tx, userId, { thoughtId })
    if (factIds.length === 0) return
    await tx
      .delete(userFactSource)
      .where(and(eq(userFactSource.userId, userId), eq(userFactSource.thoughtId, thoughtId)))
    await retireFactsWithoutLiveSource(userId, factIds, { revive: true }, tx)
  })
}

/** Called after a thought was archived: facts whose last live source it was are retired. */
export async function retireFactsForArchivedThought(
  userId: string,
  thoughtId: string,
): Promise<RetireOutcome> {
  const db = getDb()
  const factIds = await factIdsOfSource(db, userId, { thoughtId })
  return retireFactsWithoutLiveSource(userId, factIds, { revive: true }, db)
}

/** Called after a note was archived (forgotten as a whole): same for the facts derived from it. */
export async function retireFactsForArchivedNote(
  userId: string,
  textFileId: string,
): Promise<RetireOutcome> {
  const db = getDb()
  const factIds = await factIdsOfSource(db, userId, { textFileId })
  return retireFactsWithoutLiveSource(userId, factIds, { revive: true }, db)
}

/** Fact ids derived from a thought: read before the thought row is deleted (its links cascade away). */
export async function factIdsDerivedFromThought(
  userId: string,
  thoughtId: string,
): Promise<string[]> {
  return factIdsOfSource(getDb(), userId, { thoughtId })
}

/**
 * A forget request removes these facts (S2b `remove_all`): forgotten at once, their secure values
 * deleted, nothing reopened. Returns the ids that actually changed (an already-forgotten fact is
 * not one).
 */
export async function forgetUserFacts(userId: string, factIds: string[]): Promise<string[]> {
  const ids = [...new Set(factIds)]
  if (ids.length === 0) return []
  const db = getDb()
  const rows = await db
    .select({ id: userFact.id, secureValueId: userFact.secureValueId })
    .from(userFact)
    .where(
      and(eq(userFact.userId, userId), inArray(userFact.id, ids), ne(userFact.status, 'forgotten')),
    )
  if (rows.length === 0) return []

  await db
    .update(userFact)
    .set({ status: 'forgotten', updatedAt: new Date() })
    .where(
      and(
        eq(userFact.userId, userId),
        inArray(
          userFact.id,
          rows.map((r) => r.id),
        ),
      ),
    )
  const secureValueIds = rows.flatMap((r) => (r.secureValueId ? [r.secureValueId] : []))
  if (secureValueIds.length > 0) {
    await db
      .delete(userSecureValue)
      .where(and(eq(userSecureValue.userId, userId), inArray(userSecureValue.id, secureValueIds)))
  }
  return rows.map((r) => r.id)
}
