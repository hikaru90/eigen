import { and, asc, eq, isNotNull, lt, ne, sql } from 'drizzle-orm'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  nowCard,
  thought,
  thoughtEntity,
  userPreference,
  type NowCardKind,
} from '$lib/server/db/schema'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'
import { localDayKey } from '$lib/server/memory/timeline-today-server'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { activeThoughtCategoryKinds, ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { loadNowCandidates, type NowCandidates } from './now-candidates'
import { generateNowDeck, type NowDeckContext, type NowDeckDraft } from './now-deck'

/**
 * Serving and storing Now decks (docs/planning/feature-mesh-now.md, NOW-7 and NOW-8).
 * `resolveNow` holds the decisions and takes its storage and generation as dependencies so
 * every branch tests without a database; `loadNowCard` wires the real ones.
 */

const TABLE = 'now_card'
const COLUMN = 'payload'

export const NOW_DECKS_PER_DAY = 3

/** The answer keys each kind offers (NOW-1), as stable snake_case keys. */
export const NOW_ANSWER_KEYS = {
  do: ['done', 'not_now', 'too_big'],
  sort: ['done', 'drop', 'keep'],
  file: ['yes', 'other_project', 'not_a_task'],
  unblock: ['yes', 'something_else', 'someday', 'finished'],
} as const satisfies Record<NowCardKind, readonly string[]>

/** What is stored encrypted per card. `candidatesOmitted` is the deck's cut, kept so a stored deck reports it too. */
export type NowCardPayload = {
  text: string
  why: string
  suggestedStep: string | null
  notTaskCategory: string | null
  candidatesOmitted: number
}

export type StoredNowCard = {
  id: string
  kind: NowCardKind
  position: number
  targetThoughtId: string | null
  targetProjectEntityId: string | null
  payloadEncrypted: string
}

export type NowCardView = {
  id: string
  kind: NowCardKind
  text: string
  why: string
  suggestedStep?: string
  project: { id: string; label: string } | null
  answers: string[]
  /** `file` cards only: the active projects the thought could go to instead of the proposed one. */
  otherProjects?: Array<{ id: string; label: string }>
}

export type NowState =
  | { state: 'card'; card: NowCardView; remaining: number; candidatesOmitted: number }
  | { state: 'clear' }
  | { state: 'limit' }

export type NowStoreDeps = {
  /** Pending cards of earlier local days become `expired`. */
  expireEarlier: () => Promise<void>
  /** Decks written today (any status) and the pending cards of the latest one, by position. */
  readToday: () => Promise<{ deckCount: number; pending: StoredNowCard[] }>
  /** State check, no LLM: the target is no longer open, or the unblock project no longer needs a next action. */
  isStale: (card: StoredNowCard) => Promise<boolean>
  markSuperseded: (cardId: string) => Promise<void>
  loadCandidates: () => Promise<NowCandidates>
  loadContext: (candidates: NowCandidates) => Promise<NowDeckContext>
  generate: (context: NowDeckContext) => Promise<NowDeckDraft[]>
  /** Stores the deck (first writer wins) and returns the pending cards that are stored for that deck number. */
  writeDeck: (
    deckNumber: number,
    drafts: NowDeckDraft[],
    candidatesOmitted: number,
  ) => Promise<StoredNowCard[]>
  decryptPayload: (card: StoredNowCard) => Promise<NowCardPayload>
  resolveProject: (card: StoredNowCard) => Promise<{ id: string; label: string } | null>
  /** Active projects except the card's proposed one (asked for `file` cards only). */
  otherProjects: (card: StoredNowCard) => Promise<Array<{ id: string; label: string }>>
}

async function view(deps: NowStoreDeps, card: StoredNowCard, remaining: number): Promise<NowState> {
  const [payload, project, otherProjects] = await Promise.all([
    deps.decryptPayload(card),
    deps.resolveProject(card),
    card.kind === 'file' ? deps.otherProjects(card) : Promise.resolve(null),
  ])
  return {
    state: 'card',
    card: {
      id: card.id,
      kind: card.kind,
      text: payload.text,
      why: payload.why,
      ...(payload.suggestedStep ? { suggestedStep: payload.suggestedStep } : {}),
      project,
      answers: [...NOW_ANSWER_KEYS[card.kind]],
      ...(otherProjects ? { otherProjects } : {}),
    },
    remaining,
    candidatesOmitted: payload.candidatesOmitted,
  }
}

export async function resolveNow(deps: NowStoreDeps): Promise<NowState> {
  await deps.expireEarlier()
  const today = await deps.readToday()

  const pending = [...today.pending]
  while (pending.length > 0) {
    const card = pending[0]
    if (await deps.isStale(card)) {
      await deps.markSuperseded(card.id)
      pending.shift()
      continue
    }
    return view(deps, card, pending.length - 1)
  }

  if (today.deckCount >= NOW_DECKS_PER_DAY) return { state: 'limit' }
  const candidates = await deps.loadCandidates()
  if (candidates.thoughts.length + candidates.projects.length === 0) return { state: 'clear' }

  const drafts = await deps.generate(await deps.loadContext(candidates))
  const stored = await deps.writeDeck(today.deckCount + 1, drafts, candidates.candidatesOmitted)
  if (stored.length === 0) {
    throw new Error('Your next steps were written but could not be read back. Please try again.')
  }
  return view(deps, stored[0], stored.length - 1)
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORED_COLUMNS = {
  id: nowCard.id,
  kind: nowCard.kind,
  position: nowCard.position,
  targetThoughtId: nowCard.targetThoughtId,
  targetProjectEntityId: nowCard.targetProjectEntityId,
  payloadEncrypted: nowCard.payloadEncrypted,
}

export async function expireEarlierNowCards(userId: string, day: string): Promise<void> {
  await getDb()
    .update(nowCard)
    .set({ status: 'expired' })
    .where(and(eq(nowCard.userId, userId), eq(nowCard.status, 'pending'), lt(nowCard.localDay, day)))
}

async function readToday(userId: string, day: string) {
  const rows = await getDb()
    .select({ ...STORED_COLUMNS, deckNumber: nowCard.deckNumber, status: nowCard.status })
    .from(nowCard)
    .where(and(eq(nowCard.userId, userId), eq(nowCard.localDay, day)))
  const decks = new Set(rows.map((r) => r.deckNumber))
  const latest = Math.max(0, ...decks)
  const pending = rows
    .filter((r) => r.deckNumber === latest && r.status === 'pending')
    .sort((a, b) => a.position - b.position)
    .map(({ deckNumber: _deck, status: _status, ...card }) => card)
  return { deckCount: decks.size, pending }
}

export async function isNowCardStale(userId: string, card: StoredNowCard): Promise<boolean> {
  const db = getDb()
  if (card.targetThoughtId) {
    const [row] = await db
      .select({ lifecycleStatus: thought.lifecycleStatus })
      .from(thought)
      .where(and(eq(thought.userId, userId), eq(thought.id, card.targetThoughtId)))
      .limit(1)
    if (!row || row.lifecycleStatus !== 'open') return true
  }
  if (card.kind === 'unblock' && card.targetProjectEntityId) {
    const [row] = await db
      .select({
        status: canonicalEntity.projectStatus,
        nextActionThoughtId: canonicalEntity.nextActionThoughtId,
        nextActionLifecycle: thought.lifecycleStatus,
      })
      .from(canonicalEntity)
      .leftJoin(thought, eq(thought.id, canonicalEntity.nextActionThoughtId))
      .where(
        and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, card.targetProjectEntityId)),
      )
      .limit(1)
    if (!row || row.status !== 'active') return true
    if (row.nextActionThoughtId && row.nextActionLifecycle === 'open') return true
  }
  return false
}

export async function buildNowCardRows(input: {
  userId: string
  day: string
  deckNumber: number
  drafts: NowDeckDraft[]
  candidatesOmitted: number
}): Promise<Array<typeof nowCard.$inferInsert>> {
  return Promise.all(
    input.drafts.map(async (draft, index) => {
      const payload: NowCardPayload = {
        text: draft.text,
        why: draft.why,
        suggestedStep: draft.suggestedStep,
        notTaskCategory: draft.notTaskCategory,
        candidatesOmitted: input.candidatesOmitted,
      }
      return {
        userId: input.userId,
        localDay: input.day,
        deckNumber: input.deckNumber,
        position: index + 1,
        kind: draft.kind,
        targetThoughtId: draft.thoughtId,
        targetProjectEntityId: draft.projectEntityId,
        payloadEncrypted: await encryptTenantValue({
          userId: input.userId,
          table: TABLE,
          column: COLUMN,
          plaintext: JSON.stringify(payload),
        }),
      }
    }),
  )
}

/**
 * Writes the whole deck, or nothing when a deck with this number exists. The transaction
 * takes an advisory lock on (user, day, deck number) first, so two parallel requests are
 * serialised: the first inserts, the second finds rows and inserts nothing. Decks of
 * different lengths therefore never mix. The lock rides the request's reserved connection,
 * which already carries the RLS role and `app.current_user_id` (see `getDb()`); `tx` is that
 * same connection. The rows read back are the stored deck, not necessarily the one passed in.
 */
export async function writeNowDeck(
  userId: string,
  day: string,
  deckNumber: number,
  drafts: NowDeckDraft[],
  candidatesOmitted: number,
): Promise<StoredNowCard[]> {
  const rows = await buildNowCardRows({ userId, day, deckNumber, drafts, candidatesOmitted })
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${TABLE}:${userId}:${day}:${deckNumber}`}))`,
    )
    const [existing] = await tx
      .select({ id: nowCard.id })
      .from(nowCard)
      .where(
        and(
          eq(nowCard.userId, userId),
          eq(nowCard.localDay, day),
          eq(nowCard.deckNumber, deckNumber),
        ),
      )
      .limit(1)
    if (existing) return
    await tx.insert(nowCard).values(rows)
  })
  return db
    .select(STORED_COLUMNS)
    .from(nowCard)
    .where(
      and(
        eq(nowCard.userId, userId),
        eq(nowCard.localDay, day),
        eq(nowCard.deckNumber, deckNumber),
        eq(nowCard.status, 'pending'),
      ),
    )
    .orderBy(asc(nowCard.position))
}

async function resolveProject(
  userId: string,
  card: StoredNowCard,
): Promise<{ id: string; label: string } | null> {
  const db = getDb()
  if (card.targetProjectEntityId) {
    const [row] = await db
      .select({ id: canonicalEntity.id, label: canonicalEntity.label })
      .from(canonicalEntity)
      .where(
        and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, card.targetProjectEntityId)),
      )
      .limit(1)
    return row ?? null
  }
  if (!card.targetThoughtId) return null
  const [row] = await db
    .select({ id: canonicalEntity.id, label: canonicalEntity.label })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.thoughtId, card.targetThoughtId),
        projectMembershipLinkCondition(),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Active projects of this user other than `exceptProjectEntityId`, by label. */
export async function loadOtherActiveProjects(
  userId: string,
  exceptProjectEntityId: string | null,
): Promise<Array<{ id: string; label: string }>> {
  return getDb()
    .select({ id: canonicalEntity.id, label: canonicalEntity.label })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        eq(canonicalEntity.projectStatus, 'active'),
        ...(exceptProjectEntityId ? [ne(canonicalEntity.id, exceptProjectEntityId)] : []),
      ),
    )
    .orderBy(asc(canonicalEntity.label))
}

async function loadContext(
  userId: string,
  now: Date,
  candidates: NowCandidates,
): Promise<NowDeckContext> {
  const db = getDb()
  const timeZone = await getUserPreferredTimezone(userId)
  await ensureUserOntologySeeded(db, userId)
  const [ontology, [pref]] = await Promise.all([
    loadOntologyForUser(db, userId),
    db
      .select({ language: userPreference.preferredLanguage })
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .limit(1),
  ])
  return {
    language: pref?.language ?? 'en',
    localDate: localDayKey(now.toISOString(), timeZone),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now),
    localTime: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now),
    ontologyKeys: activeThoughtCategoryKinds(ontology).map((kind) => kind.key),
    candidates,
  }
}

/** The card to show on Yarn right now, writing a new deck when the rules allow it. */
export async function loadNowCard(userId: string, now: Date = new Date()): Promise<NowState> {
  const day = localDayKey(now.toISOString(), await getUserPreferredTimezone(userId))
  return resolveNow({
    expireEarlier: () => expireEarlierNowCards(userId, day),
    readToday: () => readToday(userId, day),
    isStale: (card) => isNowCardStale(userId, card),
    markSuperseded: async (cardId) => {
      await getDb()
        .update(nowCard)
        .set({ status: 'superseded' })
        .where(and(eq(nowCard.userId, userId), eq(nowCard.id, cardId)))
    },
    loadCandidates: () => loadNowCandidates(userId, now),
    loadContext: (candidates) => loadContext(userId, now, candidates),
    generate: (context) => generateNowDeck({ userId, context }),
    writeDeck: (deckNumber, drafts, omitted) =>
      writeNowDeck(userId, day, deckNumber, drafts, omitted),
    decryptPayload: async (card) =>
      JSON.parse(
        await decryptTenantValue({
          userId,
          table: TABLE,
          column: COLUMN,
          ciphertext: card.payloadEncrypted,
        }),
      ) as NowCardPayload,
    resolveProject: (card) => resolveProject(userId, card),
    otherProjects: (card) => loadOtherActiveProjects(userId, card.targetProjectEntityId),
  })
}
