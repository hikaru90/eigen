import type {
  NowAnswerCard,
  NowAnswerDeps,
  NowUndoDeps,
  NowUndoProject,
  NowUndoState,
} from './now-answer'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { captureThought } from '$lib/server/capture/service'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  nowCard,
  projectTaskSequence,
  thought,
  thoughtEntity,
  type LifecycleStatus,
} from '$lib/server/db/schema'
import { deleteMentionEdge, upsertMentionEdge } from '$lib/server/graph/age'
import { setThoughtLifecycleStatus } from '$lib/server/memory/lifecycle'
import { updateProjectStatus } from '$lib/server/memory/project-list'
import { designateNextAction, linkThoughtToProject } from '$lib/server/memory/project-next-action'
import {
  loadOrderedThoughtIdsForProject,
  orderTaskInProject,
  replaceProjectTaskSequence,
} from '$lib/server/memory/project-task-sequence'
import { setThoughtCategory } from '$lib/server/memory/thought-category'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { loadNowCard, type NowCardPayload } from './now-store'

/** The real storage and effects behind `answerNowCard` and `undoNowCard`. */

const TABLE = 'now_card'

const CLEARED = {
  status: 'pending' as const,
  answer: null,
  answeredAt: null,
  undoStateEncrypted: null,
  hiddenUntil: null,
}

async function readPayload(userId: string, ciphertext: string): Promise<NowCardPayload> {
  return JSON.parse(
    await decryptTenantValue({ userId, table: TABLE, column: 'payload', ciphertext }),
  ) as NowCardPayload
}

function sealUndo(userId: string, state: NowUndoState): Promise<string> {
  return encryptTenantValue({
    userId,
    table: TABLE,
    column: 'undo_state',
    plaintext: JSON.stringify(state),
  })
}

async function openUndo(userId: string, ciphertext: string): Promise<NowUndoState> {
  return JSON.parse(
    await decryptTenantValue({ userId, table: TABLE, column: 'undo_state', ciphertext }),
  ) as NowUndoState
}

export async function claimNowCard(
  userId: string,
  cardId: string,
  answer: string,
  now: Date,
): Promise<boolean> {
  const rows = await getDb()
    .update(nowCard)
    .set({ status: 'answered', answer, answeredAt: now })
    .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId), eq(nowCard.status, 'pending')))
    .returning({ id: nowCard.id })
  return rows.length > 0
}

export async function releaseNowCard(userId: string, cardId: string): Promise<void> {
  await getDb()
    .update(nowCard)
    .set(CLEARED)
    .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
}

export async function claimNowUndo(userId: string, cardId: string): Promise<boolean> {
  const rows = await getDb()
    .update(nowCard)
    .set(CLEARED)
    .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId), eq(nowCard.status, 'answered')))
    .returning({ id: nowCard.id })
  return rows.length > 0
}

async function snapshotThought(
  userId: string,
  thoughtId: string,
  targetProjectEntityId: string | null,
): Promise<NowUndoState> {
  const db = getDb()
  const [row] = await db
    .select({ lifecycleStatus: thought.lifecycleStatus, category: thought.category })
    .from(thought)
    .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
    .limit(1)
  if (!row) throw new Error(`Now answer: thought ${thoughtId} not found`)

  const memberships = await db
    .select({
      entityId: thoughtEntity.entityId,
      salience: thoughtEntity.salience,
      source: thoughtEntity.source,
    })
    .from(thoughtEntity)
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)))

  const memberEntityIds = memberships.map((m) => m.entityId)
  const [memberProjects, sequenced, pointed] = await Promise.all([
    memberEntityIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : db
          .select({ id: canonicalEntity.id })
          .from(canonicalEntity)
          .where(
            and(
              eq(canonicalEntity.userId, userId),
              inArray(canonicalEntity.id, memberEntityIds),
              isNotNull(canonicalEntity.projectStatus),
            ),
          ),
    db
      .select({ id: projectTaskSequence.projectEntityId })
      .from(projectTaskSequence)
      .where(and(eq(projectTaskSequence.userId, userId), eq(projectTaskSequence.thoughtId, thoughtId))),
    db
      .select({ id: canonicalEntity.id })
      .from(canonicalEntity)
      .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.nextActionThoughtId, thoughtId))),
  ])

  const projectIds = [
    ...new Set([
      ...memberProjects.map((p) => p.id),
      ...sequenced.map((p) => p.id),
      ...pointed.map((p) => p.id),
      ...(targetProjectEntityId ? [targetProjectEntityId] : []),
    ]),
  ].sort()

  const projects: NowUndoProject[] = []
  for (const projectEntityId of projectIds) {
    const [entity] = await db
      .select({
        nextActionThoughtId: canonicalEntity.nextActionThoughtId,
        projectDesignatedAt: canonicalEntity.projectDesignatedAt,
        projectStatus: canonicalEntity.projectStatus,
      })
      .from(canonicalEntity)
      .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, projectEntityId)))
      .limit(1)
    if (!entity) throw new Error(`Now answer: project ${projectEntityId} not found`)
    projects.push({
      projectEntityId,
      sequence: await loadOrderedThoughtIdsForProject(userId, projectEntityId),
      nextActionThoughtId: entity.nextActionThoughtId,
      projectDesignatedAt: entity.projectDesignatedAt?.toISOString() ?? null,
      projectStatus: entity.projectStatus,
    })
  }

  return {
    thoughtId,
    lifecycleStatus: row.lifecycleStatus,
    category: row.category,
    memberships,
    projects,
  }
}

export function buildNowAnswerDeps(userId: string, now: Date): NowAnswerDeps {
  const db = getDb
  return {
    loadCard: async (cardId): Promise<NowAnswerCard | null> => {
      const [row] = await db()
        .select({
          id: nowCard.id,
          kind: nowCard.kind,
          status: nowCard.status,
          targetThoughtId: nowCard.targetThoughtId,
          targetProjectEntityId: nowCard.targetProjectEntityId,
          payloadEncrypted: nowCard.payloadEncrypted,
        })
        .from(nowCard)
        .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
        .limit(1)
      if (!row) return null
      const { payloadEncrypted, ...rest } = row
      return { ...rest, payload: await readPayload(userId, payloadEncrypted) }
    },
    projectStatus: async (projectEntityId) => {
      const [row] = await db()
        .select({ status: canonicalEntity.projectStatus })
        .from(canonicalEntity)
        .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, projectEntityId)))
        .limit(1)
      return row?.status ?? null
    },
    claim: (cardId, answer, at) => claimNowCard(userId, cardId, answer, at),
    release: (cardId) => releaseNowCard(userId, cardId),
    hideUntil: async (cardId, until) => {
      await db()
        .update(nowCard)
        .set({ hiddenUntil: until })
        .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
    },
    timeZone: () => getUserPreferredTimezone(userId),
    setLifecycle: async (thoughtId, status) => {
      const res = await setThoughtLifecycleStatus(userId, thoughtId, status)
      if (!res.ok) throw new Error(`Now answer: thought ${thoughtId} not found`)
    },
    setCategory: async (thoughtId, categoryKey) => {
      const res = await setThoughtCategory(userId, thoughtId, categoryKey)
      if (!res.ok) throw new Error(`Now answer: could not set category (${res.reason})`)
    },
    captureStep: async (text) => (await captureThought(userId, text, { source: 'now' })).id,
    linkToProject: (projectEntityId, thoughtId) =>
      linkThoughtToProject(userId, projectEntityId, thoughtId, 'manual'),
    appendToProjectOrder: async (projectEntityId, thoughtId) => {
      await orderTaskInProject({ userId, projectEntityId, thoughtId, afterThoughtId: null })
    },
    projectHasNextAction: async (projectEntityId) => {
      const [row] = await db()
        .select({
          nextActionThoughtId: canonicalEntity.nextActionThoughtId,
          nextActionLifecycle: thought.lifecycleStatus,
        })
        .from(canonicalEntity)
        .leftJoin(thought, eq(thought.id, canonicalEntity.nextActionThoughtId))
        .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, projectEntityId)))
        .limit(1)
      return Boolean(row?.nextActionThoughtId && row.nextActionLifecycle === 'open')
    },
    designateNextAction: (projectEntityId, thoughtId) =>
      designateNextAction(userId, projectEntityId, thoughtId),
    setProjectStatus: async (projectEntityId, status) => {
      await updateProjectStatus(userId, projectEntityId, status)
    },
    snapshot: (thoughtId, targetProjectEntityId) =>
      snapshotThought(userId, thoughtId, targetProjectEntityId),
    saveUndo: async (cardId, state) => {
      await db()
        .update(nowCard)
        .set({ undoStateEncrypted: await sealUndo(userId, state) })
        .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
    },
    loadNext: () => loadNowCard(userId, now),
  }
}

export function buildNowUndoDeps(userId: string, now: Date): NowUndoDeps {
  const db = getDb
  return {
    loadCard: async (cardId) => {
      const [row] = await db()
        .select({
          id: nowCard.id,
          status: nowCard.status,
          answer: nowCard.answer,
          answeredAt: nowCard.answeredAt,
          undoStateEncrypted: nowCard.undoStateEncrypted,
        })
        .from(nowCard)
        .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
        .limit(1)
      if (!row) return null
      const { undoStateEncrypted, ...rest } = row
      return {
        ...rest,
        undoState: undoStateEncrypted ? await openUndo(userId, undoStateEncrypted) : null,
      }
    },
    latestAnsweredCardId: async () => {
      const [row] = await db()
        .select({ id: nowCard.id })
        .from(nowCard)
        .where(and(eq(nowCard.userId, userId), eq(nowCard.status, 'answered')))
        .orderBy(desc(nowCard.answeredAt))
        .limit(1)
      return row?.id ?? null
    },
    claimUndo: (cardId) => claimNowUndo(userId, cardId),
    reinstate: async (cardId, prior) => {
      await db()
        .update(nowCard)
        .set({
          status: 'answered',
          answer: prior.answer,
          answeredAt: prior.answeredAt,
          undoStateEncrypted: await sealUndo(userId, prior.undoState),
        })
        .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
    },
    restoreMemberships: async (thoughtId, memberships) => {
      const current = await db()
        .select({ entityId: thoughtEntity.entityId })
        .from(thoughtEntity)
        .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)))
      const currentIds = new Set(current.map((r) => r.entityId))
      const recorded = new Set(memberships.map((m) => m.entityId))
      for (const entityId of currentIds) {
        if (recorded.has(entityId)) continue
        await db()
          .delete(thoughtEntity)
          .where(
            and(
              eq(thoughtEntity.userId, userId),
              eq(thoughtEntity.thoughtId, thoughtId),
              eq(thoughtEntity.entityId, entityId),
            ),
          )
        await deleteMentionEdge({ userId, thoughtId, entityId })
      }
      for (const m of memberships) {
        await db()
          .insert(thoughtEntity)
          .values({ userId, thoughtId, entityId: m.entityId, salience: m.salience, source: m.source })
          .onConflictDoUpdate({
            target: [thoughtEntity.thoughtId, thoughtEntity.entityId],
            set: { salience: m.salience, source: m.source },
          })
        if (!currentIds.has(m.entityId)) {
          await upsertMentionEdge({ userId, thoughtId, entityId: m.entityId })
        }
      }
    },
    restoreCategory: async (thoughtId, categoryKey) => {
      const [row] = await db()
        .select({ category: thought.category })
        .from(thought)
        .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
        .limit(1)
      if (!row) throw new Error(`Now undo: thought ${thoughtId} not found`)
      if (row.category === categoryKey) return
      const res = await setThoughtCategory(userId, thoughtId, categoryKey)
      if (!res.ok) throw new Error(`Now undo: could not restore category (${res.reason})`)
    },
    restoreLifecycle: async (thoughtId, status: LifecycleStatus) => {
      const [row] = await db()
        .select({ lifecycleStatus: thought.lifecycleStatus })
        .from(thought)
        .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
        .limit(1)
      if (!row) throw new Error(`Now undo: thought ${thoughtId} not found`)
      if (row.lifecycleStatus === status) return
      const res = await setThoughtLifecycleStatus(userId, thoughtId, status)
      if (!res.ok) throw new Error(`Now undo: thought ${thoughtId} not found`)
    },
    restoreSequence: (projectEntityId, orderedThoughtIds) =>
      replaceProjectTaskSequence({ userId, projectEntityId, orderedThoughtIds }),
    restoreProjectPointers: async (project) => {
      await db()
        .update(canonicalEntity)
        .set({
          nextActionThoughtId: project.nextActionThoughtId,
          projectDesignatedAt: project.projectDesignatedAt
            ? new Date(project.projectDesignatedAt)
            : null,
          ...(project.projectStatus ? { projectStatus: project.projectStatus as 'active' } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, project.projectEntityId)))
    },
    loadNext: () => loadNowCard(userId, now),
  }
}
