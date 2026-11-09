import type { LifecycleStatus, NowCardKind, NowCardStatus } from '$lib/server/db/schema'
import { localDayKey } from '$lib/server/memory/timeline-today-server'
import { buildNowAnswerDeps, buildNowUndoDeps } from './now-answer-deps'
import { NOW_ANSWER_KEYS, type NowCardPayload, type NowState } from './now-store'

/**
 * Answering a Now card and undoing the answer (docs/planning/feature-mesh-now.md, NOW-2 and
 * NOW-3). `runNowAnswer` / `runNowUndo` hold the decisions and take their storage and effects
 * as dependencies so every branch tests without a database; `answerNowCard` / `undoNowCard`
 * wire the real ones (`now-answer-deps.ts`). Every effect reuses an existing write; nothing
 * here creates or promotes a project (NOW-AC20).
 */

export const UNDO_WINDOW_MS = 6_000
const KEEP_HIDDEN_MS = 30 * 24 * 60 * 60 * 1000
const TEXT_MAX = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A failure the caller can show as is: 400 bad input, 404 not this user's card, 409 wrong state. */
export class NowAnswerError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'NowAnswerError'
  }
}

export type NowAnswerCard = {
  id: string
  kind: NowCardKind
  status: NowCardStatus
  targetThoughtId: string | null
  targetProjectEntityId: string | null
  payload: NowCardPayload
}

/** The exact prior state Undo restores. Stored encrypted on the card. */
export type NowUndoState = {
  thoughtId: string
  lifecycleStatus: LifecycleStatus
  category: string
  memberships: Array<{ entityId: string; salience: number; source: 'ingest' | 'manual' | 'project' }>
  /** Every project the thought was in (member, sequenced or next action) or is moved to. */
  projects: NowUndoProject[]
}

export type NowUndoProject = {
  projectEntityId: string
  sequence: string[]
  nextActionThoughtId: string | null
  projectDesignatedAt: string | null
  projectStatus: string | null
}

export type NowAnswerDeps = {
  /** This user's card, or null. */
  loadCard: (cardId: string) => Promise<NowAnswerCard | null>
  /** `project_status` of an entity of this user; null when it is missing or not a project. */
  projectStatus: (projectEntityId: string) => Promise<string | null>
  /** `pending -> answered`; false when the card was no longer pending (nothing is written). */
  claim: (cardId: string, answer: string, now: Date) => Promise<boolean>
  /** Back to `pending`, clearing the answer, its time, its undo state and its hiding. */
  release: (cardId: string) => Promise<void>
  hideUntil: (cardId: string, until: Date) => Promise<void>
  timeZone: () => Promise<string>
  setLifecycle: (thoughtId: string, status: 'completed' | 'archived') => Promise<void>
  setCategory: (thoughtId: string, categoryKey: string) => Promise<void>
  /** Captures the text as a new thought (source `now`) and returns its id. */
  captureStep: (text: string) => Promise<string>
  linkToProject: (projectEntityId: string, thoughtId: string) => Promise<void>
  appendToProjectOrder: (projectEntityId: string, thoughtId: string) => Promise<void>
  projectHasNextAction: (projectEntityId: string) => Promise<boolean>
  designateNextAction: (projectEntityId: string, thoughtId: string) => Promise<void>
  setProjectStatus: (projectEntityId: string, status: 'someday' | 'completed') => Promise<void>
  snapshot: (thoughtId: string, targetProjectEntityId: string | null) => Promise<NowUndoState>
  saveUndo: (cardId: string, state: NowUndoState) => Promise<void>
  loadNext: () => Promise<NowState>
}

export type NowAnswerInput = {
  cardId: string
  answer: string
  projectEntityId?: string
  text?: string
  now: Date
}

export type NowAnswerResult = (NowState | { state: 'error'; error: string }) & {
  undo: { cardId: string } | null
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wallAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The instant the next local day begins in `timeZone` (follows DST). */
export function startOfNextLocalDay(now: Date, timeZone: string): Date {
  const [year, month, day] = localDayKey(now.toISOString(), timeZone).split('-').map(Number)
  const wall = Date.UTC(year, month - 1, day + 1, 0, 0, 0)
  const first = wall - offsetMs(new Date(wall), timeZone)
  return new Date(wall - offsetMs(new Date(first), timeZone))
}

type Validated = {
  /** Project a project-answer applies to: the card's own, or the chosen one. */
  projectEntityId: string | null
  text: string | null
}

async function validateAnswer(
  deps: NowAnswerDeps,
  card: NowAnswerCard,
  input: NowAnswerInput,
): Promise<Validated> {
  const allowed: readonly string[] = NOW_ANSWER_KEYS[card.kind]
  if (!allowed.includes(input.answer)) {
    throw new NowAnswerError(400, `answer must be one of: ${allowed.join(', ')}`)
  }
  const { answer } = input

  if (input.projectEntityId !== undefined && answer !== 'other_project') {
    throw new NowAnswerError(400, 'projectEntityId is only allowed for other_project')
  }
  if (input.text !== undefined && answer !== 'something_else') {
    throw new NowAnswerError(400, 'text is only allowed for something_else')
  }

  if (answer === 'other_project') {
    const id = input.projectEntityId
    if (typeof id !== 'string' || !isUuid(id)) {
      throw new NowAnswerError(400, 'projectEntityId is required for other_project and must be a project id')
    }
    if ((await deps.projectStatus(id)) !== 'active') {
      throw new NowAnswerError(400, 'projectEntityId must be an active project of yours')
    }
    return { projectEntityId: id, text: null }
  }

  let text: string | null = null
  if (answer === 'something_else') {
    text = typeof input.text === 'string' ? input.text.trim() : ''
    if (text.length === 0) throw new NowAnswerError(400, 'text is required for something_else')
    if (text.length > TEXT_MAX) {
      throw new NowAnswerError(400, `text must be at most ${TEXT_MAX} characters`)
    }
  }

  const needsCardProject = card.kind === 'unblock' || (card.kind === 'file' && answer === 'yes')
  if (needsCardProject) {
    const id = card.targetProjectEntityId
    if (!id || (await deps.projectStatus(id)) === null) {
      throw new NowAnswerError(400, 'The card\'s project is not a project, so nothing was changed')
    }
    return { projectEntityId: id, text }
  }
  return { projectEntityId: null, text }
}

function isUndoable(kind: NowCardKind, answer: string): boolean {
  if (answer === 'done' || answer === 'drop') return true
  return kind === 'file' && (answer === 'yes' || answer === 'other_project' || answer === 'not_a_task')
}

function requireThought(card: NowAnswerCard): string {
  if (!card.targetThoughtId) throw new Error(`Now card ${card.id} has no thought to act on`)
  return card.targetThoughtId
}

async function placeInProject(deps: NowAnswerDeps, projectEntityId: string, thoughtId: string) {
  await deps.linkToProject(projectEntityId, thoughtId)
  await deps.appendToProjectOrder(projectEntityId, thoughtId)
}

async function applyEffects(
  deps: NowAnswerDeps,
  card: NowAnswerCard,
  input: NowAnswerInput,
  v: Validated,
): Promise<void> {
  switch (input.answer) {
    case 'done':
      return deps.setLifecycle(requireThought(card), 'completed')
    case 'drop':
      return deps.setLifecycle(requireThought(card), 'archived')
    case 'keep':
      return deps.hideUntil(card.id, new Date(input.now.getTime() + KEEP_HIDDEN_MS))
    case 'not_now':
    case 'too_big':
      return deps.hideUntil(card.id, startOfNextLocalDay(input.now, await deps.timeZone()))
    case 'yes':
    case 'other_project': {
      const projectId = v.projectEntityId as string
      if (card.kind === 'unblock') {
        const step = card.payload.suggestedStep
        if (!step) throw new Error(`Now card ${card.id} has no suggested step`)
        const created = await deps.captureStep(step)
        await placeInProject(deps, projectId, created)
        return deps.designateNextAction(projectId, created)
      }
      const thoughtId = requireThought(card)
      await placeInProject(deps, projectId, thoughtId)
      if (!(await deps.projectHasNextAction(projectId))) {
        await deps.designateNextAction(projectId, thoughtId)
      }
      return
    }
    case 'not_a_task': {
      const category = card.payload.notTaskCategory
      if (!category) throw new Error(`Now card ${card.id} has no notTaskCategory`)
      return deps.setCategory(requireThought(card), category)
    }
    case 'something_else': {
      const projectId = v.projectEntityId as string
      const created = await deps.captureStep(v.text as string)
      await placeInProject(deps, projectId, created)
      return deps.designateNextAction(projectId, created)
    }
    case 'someday':
      return deps.setProjectStatus(v.projectEntityId as string, 'someday')
    case 'finished':
      return deps.setProjectStatus(v.projectEntityId as string, 'completed')
    default:
      throw new Error(`Unhandled Now answer ${input.answer}`)
  }
}

async function releaseQuietly(release: () => Promise<void>, cardId: string) {
  try {
    await release()
  } catch (err) {
    console.error('[now.answer] release failed', {
      cardId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function runNowAnswer(
  deps: NowAnswerDeps,
  input: NowAnswerInput,
): Promise<NowAnswerResult> {
  if (!isUuid(input.cardId)) throw new NowAnswerError(404, 'Card not found')
  const card = await deps.loadCard(input.cardId)
  if (!card) throw new NowAnswerError(404, 'Card not found')

  const validated = await validateAnswer(deps, card, input)

  if (!(await deps.claim(card.id, input.answer, input.now))) {
    throw new NowAnswerError(409, 'This card was already answered')
  }

  const undoable = isUndoable(card.kind, input.answer)
  try {
    if (undoable) {
      const state = await deps.snapshot(requireThought(card), validated.projectEntityId)
      await deps.saveUndo(card.id, state)
    }
    await applyEffects(deps, card, input, validated)
  } catch (err) {
    await releaseQuietly(() => deps.release(card.id), card.id)
    throw err
  }

  const undo = undoable ? { cardId: card.id } : null
  try {
    return { ...(await deps.loadNext()), undo }
  } catch (err) {
    // the answer stands; the page shows Try again
    return { state: 'error', error: err instanceof Error ? err.message : String(err), undo }
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export type NowUndoDeps = {
  loadCard: (cardId: string) => Promise<{
    id: string
    status: NowCardStatus
    answer: string | null
    answeredAt: Date | null
    undoState: NowUndoState | null
  } | null>
  latestAnsweredCardId: () => Promise<string | null>
  /** `answered -> pending`, clearing answer, time and undo state; false when it was not answered. */
  claimUndo: (cardId: string) => Promise<boolean>
  /** Puts an answered card back as it was after a failed restore. */
  reinstate: (
    cardId: string,
    prior: { answer: string | null; answeredAt: Date | null; undoState: NowUndoState },
  ) => Promise<void>
  restoreMemberships: (thoughtId: string, memberships: NowUndoState['memberships']) => Promise<void>
  restoreCategory: (thoughtId: string, categoryKey: string) => Promise<void>
  restoreLifecycle: (thoughtId: string, status: LifecycleStatus) => Promise<void>
  restoreSequence: (projectEntityId: string, orderedThoughtIds: string[]) => Promise<void>
  restoreProjectPointers: (project: NowUndoProject) => Promise<void>
  loadNext: () => Promise<NowState>
}

export async function runNowUndo(
  deps: NowUndoDeps,
  input: { cardId: string; now: Date },
): Promise<NowState> {
  if (!isUuid(input.cardId)) throw new NowAnswerError(404, 'Card not found')
  const card = await deps.loadCard(input.cardId)
  if (!card) throw new NowAnswerError(404, 'Card not found')

  const { answeredAt, undoState } = card
  if (card.status !== 'answered' || !answeredAt || !undoState) {
    throw new NowAnswerError(409, 'This answer cannot be undone')
  }
  if (input.now.getTime() - answeredAt.getTime() > UNDO_WINDOW_MS) {
    throw new NowAnswerError(409, 'The 6 seconds to undo this answer have passed')
  }
  if ((await deps.latestAnsweredCardId()) !== card.id) {
    throw new NowAnswerError(409, 'Only the latest answer can be undone')
  }
  if (!(await deps.claimUndo(card.id))) {
    throw new NowAnswerError(409, 'This answer cannot be undone')
  }

  try {
    // memberships first, so a reopen rebuilds the mention edges from the restored rows
    await deps.restoreMemberships(undoState.thoughtId, undoState.memberships)
    await deps.restoreCategory(undoState.thoughtId, undoState.category)
    await deps.restoreLifecycle(undoState.thoughtId, undoState.lifecycleStatus)
    for (const project of undoState.projects) {
      await deps.restoreSequence(project.projectEntityId, project.sequence)
    }
    for (const project of undoState.projects) {
      await deps.restoreProjectPointers(project)
    }
  } catch (err) {
    await releaseQuietly(
      () => deps.reinstate(card.id, { answer: card.answer, answeredAt, undoState }),
      card.id,
    )
    throw err
  }
  return deps.loadNext()
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function answerNowCard(
  input: Omit<NowAnswerInput, 'now'> & { userId: string; now?: Date },
): Promise<NowAnswerResult> {
  const now = input.now ?? new Date()
  const { userId, ...rest } = input
  return runNowAnswer(buildNowAnswerDeps(userId, now), { ...rest, now })
}

export async function undoNowCard(input: {
  userId: string
  cardId: string
  now?: Date
}): Promise<NowState> {
  const now = input.now ?? new Date()
  return runNowUndo(buildNowUndoDeps(input.userId, now), { cardId: input.cardId, now })
}
