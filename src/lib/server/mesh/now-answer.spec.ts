import { beforeEach, describe, expect, it, vi } from 'vitest'

const { buildDepsMock } = vi.hoisted(() => ({ buildDepsMock: vi.fn() }))
vi.mock('./now-answer-deps', () => ({
  buildNowAnswerDeps: buildDepsMock,
  buildNowUndoDeps: buildDepsMock,
}))

import type { NowState } from './now-store'
import type { NowCardKind } from '$lib/server/db/schema'
import {
  answerNowCard,
  NowAnswerError,
  runNowAnswer,
  runNowUndo,
  startOfNextLocalDay,
  undoNowCard,
  type NowAnswerCard,
  type NowAnswerDeps,
  type NowUndoDeps,
  type NowUndoState,
} from './now-answer'

const USER = 'u1'
const CARD = '11111111-1111-4111-8111-111111111111'
const THOUGHT = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const NEW_THOUGHT = '55555555-5555-4555-8555-555555555555'
const NOW = new Date('2026-11-09T10:00:00.000Z') // 11:00 in Berlin, Monday

const nextCard: NowState = {
  state: 'card',
  card: { id: 'next', kind: 'do', text: 'Next', why: 'Because', project: null, answers: ['done'] },
  remaining: 0,
  candidatesOmitted: 0,
}

function card(kind: NowCardKind, over: Partial<NowAnswerCard> = {}): NowAnswerCard {
  return {
    id: CARD,
    kind,
    status: 'pending',
    targetThoughtId: kind === 'unblock' ? null : THOUGHT,
    targetProjectEntityId: kind === 'file' || kind === 'unblock' ? PROJECT : null,
    payload: {
      text: 'Do the thing',
      why: 'Because',
      suggestedStep: kind === 'unblock' ? 'Book the site visit' : null,
      notTaskCategory: kind === 'file' ? 'note' : null,
      candidatesOmitted: 0,
    },
    ...over,
  }
}

const undoState: NowUndoState = {
  thoughtId: THOUGHT,
  lifecycleStatus: 'open',
  category: 'task',
  memberships: [{ entityId: PROJECT, salience: 0.6, source: 'ingest' }],
  projects: [
    {
      projectEntityId: PROJECT,
      sequence: ['a', 'b'],
      nextActionThoughtId: 'a',
      projectDesignatedAt: '2026-11-01T08:00:00.000Z',
      projectStatus: 'active',
    },
  ],
}

type Calls = Array<[string, ...unknown[]]>

function fakeDeps(
  loaded: NowAnswerCard | null,
  over: { projectStatus?: Record<string, string | null>; hasNextAction?: boolean; claim?: boolean } = {},
) {
  const calls: Calls = []
  const log =
    <T>(name: string, value?: T) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return value as T
    }
  const statuses = over.projectStatus ?? { [PROJECT]: 'active', [OTHER_PROJECT]: 'active' }
  let claimOpen = over.claim ?? true
  const deps = {
    loadCard: vi.fn(log('loadCard', loaded)),
    projectStatus: vi.fn(async (id: string) => statuses[id] ?? null),
    claim: vi.fn(async (...args: unknown[]) => {
      calls.push(['claim', ...args])
      const ok = claimOpen
      claimOpen = false
      return ok
    }),
    release: vi.fn(log('release')),
    hideUntil: vi.fn(log('hideUntil')),
    timeZone: vi.fn(async () => 'Europe/Berlin'),
    setLifecycle: vi.fn(log('setLifecycle')),
    setCategory: vi.fn(log('setCategory')),
    captureStep: vi.fn(log('captureStep', NEW_THOUGHT)),
    linkToProject: vi.fn(log('linkToProject')),
    appendToProjectOrder: vi.fn(log('appendToProjectOrder')),
    projectHasNextAction: vi.fn(async (id: string) => {
      calls.push(['projectHasNextAction', id])
      return over.hasNextAction ?? false
    }),
    designateNextAction: vi.fn(log('designateNextAction')),
    setProjectStatus: vi.fn(log('setProjectStatus')),
    snapshot: vi.fn(log('snapshot', undoState)),
    saveUndo: vi.fn(log('saveUndo')),
    loadNext: vi.fn(log('loadNext', nextCard)),
  } satisfies NowAnswerDeps
  return { deps, calls }
}

const names = (calls: Calls) => calls.map((c) => c[0])

const input = (answer: string, extra: Record<string, unknown> = {}) => ({
  cardId: CARD,
  answer,
  now: NOW,
  ...extra,
})

async function expectAnswerError(p: Promise<unknown>, status: number, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(NowAnswerError)
  expect((err as NowAnswerError).status).toBe(status)
  if (message) expect((err as NowAnswerError).message).toMatch(message)
}

describe('startOfNextLocalDay', () => {
  it('is the next local midnight in the user timezone, as an instant', () => {
    expect(startOfNextLocalDay(new Date('2026-11-09T10:00:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-11-09T23:00:00.000Z',
    )
    expect(startOfNextLocalDay(new Date('2026-07-09T10:00:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-07-09T22:00:00.000Z',
    )
    expect(startOfNextLocalDay(new Date('2026-11-09T10:00:00Z'), 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-10T08:00:00.000Z',
    )
  })

  it('uses the local day, not the UTC day, near midnight', () => {
    // 23:30 Berlin on the 9th is still the 9th locally, 22:30 UTC
    expect(startOfNextLocalDay(new Date('2026-11-09T22:30:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-11-09T23:00:00.000Z',
    )
    // 00:30 Berlin on the 10th is already the 10th
    expect(startOfNextLocalDay(new Date('2026-11-09T23:30:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-11-10T23:00:00.000Z',
    )
  })

  it('follows DST changes', () => {
    // 28 Mar 2026 23:30 CET: the next day (29th) starts at 23:00Z; 29th evening CEST -> 30th starts 22:00Z
    expect(startOfNextLocalDay(new Date('2026-03-28T22:30:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    )
    expect(startOfNextLocalDay(new Date('2026-03-29T20:00:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    )
    // 24 Oct 2026 evening CEST -> 25th is a 25-hour day; 25th evening CET -> 26th starts 23:00Z
    expect(startOfNextLocalDay(new Date('2026-10-25T20:00:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    )
  })
})

describe('runNowAnswer: every row of NOW-2 with its exact calls', () => {
  it('done: completes the thought, after recording undo state', async () => {
    const { deps, calls } = fakeDeps(card('do'))
    const res = await runNowAnswer(deps, input('done'))
    expect(calls.map((c) => c[0])).toEqual([
      'loadCard',
      'claim',
      'snapshot',
      'saveUndo',
      'setLifecycle',
      'loadNext',
    ])
    expect(deps.claim).toHaveBeenCalledWith(CARD, 'done', NOW)
    expect(deps.snapshot).toHaveBeenCalledWith(THOUGHT, null)
    expect(deps.saveUndo).toHaveBeenCalledWith(CARD, undoState)
    expect(deps.setLifecycle).toHaveBeenCalledWith(THOUGHT, 'completed')
    expect(res).toEqual({ ...nextCard, undo: { cardId: CARD } })
  })

  it('drop: archives the thought, after recording undo state', async () => {
    const { deps, calls } = fakeDeps(card('sort'))
    const res = await runNowAnswer(deps, input('drop'))
    expect(names(calls)).toEqual(['loadCard', 'claim', 'snapshot', 'saveUndo', 'setLifecycle', 'loadNext'])
    expect(deps.setLifecycle).toHaveBeenCalledWith(THOUGHT, 'archived')
    expect(res.undo).toEqual({ cardId: CARD })
  })

  it('done on a sort card completes too', async () => {
    const { deps } = fakeDeps(card('sort'))
    await runNowAnswer(deps, input('done'))
    expect(deps.setLifecycle).toHaveBeenCalledWith(THOUGHT, 'completed')
  })

  it('keep: hides the card target for 30 days, writes nothing else, no undo', async () => {
    const { deps, calls } = fakeDeps(card('sort'))
    const res = await runNowAnswer(deps, input('keep'))
    expect(names(calls)).toEqual(['loadCard', 'claim', 'hideUntil', 'loadNext'])
    expect(deps.hideUntil).toHaveBeenCalledWith(CARD, new Date('2026-12-09T10:00:00.000Z'))
    expect(deps.saveUndo).not.toHaveBeenCalled()
    expect(res.undo).toBeNull()
  })

  it.each([
    ['do', 'not_now'],
    ['do', 'too_big'],
  ] as const)('%s / %s: hides until the start of the next local day, no undo', async (kind, answer) => {
    const { deps, calls } = fakeDeps(card(kind))
    const res = await runNowAnswer(deps, input(answer))
    expect(names(calls)).toEqual(['loadCard', 'claim', 'hideUntil', 'loadNext'])
    expect(deps.hideUntil).toHaveBeenCalledWith(CARD, new Date('2026-11-09T23:00:00.000Z'))
    expect(deps.setLifecycle).not.toHaveBeenCalled()
    expect(res.undo).toBeNull()
  })

  it('file / yes: joins the project, goes last, becomes next action when there is none', async () => {
    const { deps, calls } = fakeDeps(card('file'), { hasNextAction: false })
    const res = await runNowAnswer(deps, input('yes'))
    expect(names(calls)).toEqual([
      'loadCard',
      'claim',
      'snapshot',
      'saveUndo',
      'linkToProject',
      'appendToProjectOrder',
      'projectHasNextAction',
      'designateNextAction',
      'loadNext',
    ])
    expect(deps.snapshot).toHaveBeenCalledWith(THOUGHT, PROJECT)
    expect(deps.linkToProject).toHaveBeenCalledWith(PROJECT, THOUGHT)
    expect(deps.appendToProjectOrder).toHaveBeenCalledWith(PROJECT, THOUGHT)
    expect(deps.designateNextAction).toHaveBeenCalledWith(PROJECT, THOUGHT)
    expect(res.undo).toEqual({ cardId: CARD })
  })

  it('file / yes: leaves an existing next action alone', async () => {
    const { deps } = fakeDeps(card('file'), { hasNextAction: true })
    await runNowAnswer(deps, input('yes'))
    expect(deps.linkToProject).toHaveBeenCalledWith(PROJECT, THOUGHT)
    expect(deps.appendToProjectOrder).toHaveBeenCalledWith(PROJECT, THOUGHT)
    expect(deps.designateNextAction).not.toHaveBeenCalled()
  })

  it('file / other_project: same effects against the chosen project, snapshot covers it', async () => {
    const { deps } = fakeDeps(card('file'), { hasNextAction: false })
    const res = await runNowAnswer(deps, input('other_project', { projectEntityId: OTHER_PROJECT }))
    expect(deps.snapshot).toHaveBeenCalledWith(THOUGHT, OTHER_PROJECT)
    expect(deps.linkToProject).toHaveBeenCalledWith(OTHER_PROJECT, THOUGHT)
    expect(deps.appendToProjectOrder).toHaveBeenCalledWith(OTHER_PROJECT, THOUGHT)
    expect(deps.designateNextAction).toHaveBeenCalledWith(OTHER_PROJECT, THOUGHT)
    expect(res.undo).toEqual({ cardId: CARD })
  })

  it('file / not_a_task: sets the stored notTaskCategory, after recording undo state', async () => {
    const { deps, calls } = fakeDeps(card('file'))
    const res = await runNowAnswer(deps, input('not_a_task'))
    expect(names(calls)).toEqual(['loadCard', 'claim', 'snapshot', 'saveUndo', 'setCategory', 'loadNext'])
    expect(deps.setCategory).toHaveBeenCalledWith(THOUGHT, 'note')
    expect(deps.linkToProject).not.toHaveBeenCalled()
    expect(res.undo).toEqual({ cardId: CARD })
  })

  it('unblock / yes: captures the suggestion (source now), links, orders last, designates, no undo', async () => {
    const { deps, calls } = fakeDeps(card('unblock'), { hasNextAction: false })
    const res = await runNowAnswer(deps, input('yes'))
    expect(names(calls)).toEqual([
      'loadCard',
      'claim',
      'captureStep',
      'linkToProject',
      'appendToProjectOrder',
      'designateNextAction',
      'loadNext',
    ])
    expect(deps.captureStep).toHaveBeenCalledWith('Book the site visit')
    expect(deps.linkToProject).toHaveBeenCalledWith(PROJECT, NEW_THOUGHT)
    expect(deps.appendToProjectOrder).toHaveBeenCalledWith(PROJECT, NEW_THOUGHT)
    expect(deps.designateNextAction).toHaveBeenCalledWith(PROJECT, NEW_THOUGHT)
    expect(deps.snapshot).not.toHaveBeenCalled()
    expect(deps.saveUndo).not.toHaveBeenCalled()
    expect(res.undo).toBeNull()
  })

  it('unblock / something_else: same with the typed text, trimmed', async () => {
    const { deps } = fakeDeps(card('unblock'))
    const res = await runNowAnswer(deps, input('something_else', { text: '  Call the plumber  ' }))
    expect(deps.captureStep).toHaveBeenCalledWith('Call the plumber')
    expect(deps.designateNextAction).toHaveBeenCalledWith(PROJECT, NEW_THOUGHT)
    expect(res.undo).toBeNull()
  })

  it.each([
    ['someday', 'someday'],
    ['finished', 'completed'],
  ] as const)('unblock / %s: writes project status %s and creates no thought', async (answer, status) => {
    const { deps, calls } = fakeDeps(card('unblock'))
    const res = await runNowAnswer(deps, input(answer))
    expect(names(calls)).toEqual(['loadCard', 'claim', 'setProjectStatus', 'loadNext'])
    expect(deps.setProjectStatus).toHaveBeenCalledWith(PROJECT, status)
    expect(deps.captureStep).not.toHaveBeenCalled()
    expect(res.undo).toBeNull()
  })
})

describe('runNowAnswer: validation (nothing written)', () => {
  it('404 when the card is not this user\'s, revealing nothing', async () => {
    const { deps } = fakeDeps(null)
    await expectAnswerError(runNowAnswer(deps, input('done')), 404, /not found/i)
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.setLifecycle).not.toHaveBeenCalled()
  })

  it('404 for a card id that is not a uuid, without touching the store', async () => {
    const { deps } = fakeDeps(card('do'))
    await expectAnswerError(runNowAnswer(deps, { ...input('done'), cardId: 'nope' }), 404)
    expect(deps.loadCard).not.toHaveBeenCalled()
  })

  it.each([
    ['do', 'drop', 'done, not_now, too_big'],
    ['sort', 'not_now', 'done, drop, keep'],
    ['file', 'done', 'yes, other_project, not_a_task'],
    ['unblock', 'keep', 'yes, something_else, someday, finished'],
    ['do', 'unknown', 'done, not_now, too_big'],
    ['do', '', 'done, not_now, too_big'],
  ] as const)('400 for %s card answered "%s", naming the allowed keys', async (kind, answer, allowed) => {
    const { deps } = fakeDeps(card(kind))
    await expectAnswerError(runNowAnswer(deps, input(answer)), 400, new RegExp(allowed))
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it('400 when other_project has no projectEntityId, or a malformed one', async () => {
    const { deps } = fakeDeps(card('file'))
    await expectAnswerError(runNowAnswer(deps, input('other_project')), 400, /projectEntityId/)
    await expectAnswerError(
      runNowAnswer(deps, input('other_project', { projectEntityId: 'a b' })),
      400,
      /projectEntityId/,
    )
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it('400 when the chosen project is missing, not a project or not active', async () => {
    const { deps } = fakeDeps(card('file'), {
      projectStatus: { [OTHER_PROJECT]: 'someday', [PROJECT]: 'active' },
    })
    await expectAnswerError(
      runNowAnswer(deps, input('other_project', { projectEntityId: OTHER_PROJECT })),
      400,
      /active project/,
    )
    await expectAnswerError(
      runNowAnswer(deps, input('other_project', { projectEntityId: '66666666-6666-4666-8666-666666666666' })),
      400,
      /active project/,
    )
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it('other_project may name any active project, even the card\'s own', async () => {
    const { deps } = fakeDeps(card('file'))
    await runNowAnswer(deps, input('other_project', { projectEntityId: PROJECT }))
    expect(deps.linkToProject).toHaveBeenCalledWith(PROJECT, THOUGHT)
  })

  it('400 when something_else has no text, only whitespace, or more than 500 characters', async () => {
    const { deps } = fakeDeps(card('unblock'))
    await expectAnswerError(runNowAnswer(deps, input('something_else')), 400, /text/)
    await expectAnswerError(runNowAnswer(deps, input('something_else', { text: '   \n ' })), 400, /text/)
    await expectAnswerError(
      runNowAnswer(deps, input('something_else', { text: 'x'.repeat(501) })),
      400,
      /500/,
    )
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it('accepts text of exactly 500 characters and counts after trimming', async () => {
    const { deps } = fakeDeps(card('unblock'))
    await runNowAnswer(deps, input('something_else', { text: ` ${'x'.repeat(500)} ` }))
    expect(deps.captureStep).toHaveBeenCalledWith('x'.repeat(500))
  })

  it('400 for fields that do not belong to the answer', async () => {
    const { deps } = fakeDeps(card('do'))
    await expectAnswerError(
      runNowAnswer(deps, input('done', { projectEntityId: PROJECT })),
      400,
      /projectEntityId/,
    )
    await expectAnswerError(runNowAnswer(deps, input('done', { text: 'hi' })), 400, /text/)
    expect(deps.claim).not.toHaveBeenCalled()
  })
})

describe('runNowAnswer: no project is ever created or promoted (NOW-AC20)', () => {
  it('offers no way to create a project: the deps have no creation or promotion function', () => {
    const { deps } = fakeDeps(card('do'))
    expect(Object.keys(deps).filter((k) => /create|promote|ensureProject/i.test(k))).toEqual([])
  })

  it('rejects a file card whose project slot holds an ingredient (no project_status)', async () => {
    const { deps } = fakeDeps(card('file'), { projectStatus: { [PROJECT]: null } })
    await expectAnswerError(runNowAnswer(deps, input('yes')), 400, /project/i)
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.linkToProject).not.toHaveBeenCalled()
    expect(deps.designateNextAction).not.toHaveBeenCalled()
  })

  it('rejects an unblock card whose project slot holds a relative label, for every project answer', async () => {
    for (const [answer, extra] of [
      ['yes', {}],
      ['something_else', { text: 'Call' }],
      ['someday', {}],
      ['finished', {}],
    ] as const) {
      const { deps } = fakeDeps(card('unblock'), { projectStatus: { [PROJECT]: null } })
      await expectAnswerError(runNowAnswer(deps, input(answer, extra)), 400, /project/i)
      expect(deps.claim).not.toHaveBeenCalled()
      expect(deps.captureStep).not.toHaveBeenCalled()
      expect(deps.setProjectStatus).not.toHaveBeenCalled()
    }
  })

  it('rejects other_project aimed at an entity with no project_status', async () => {
    const { deps } = fakeDeps(card('file'), { projectStatus: { [OTHER_PROJECT]: null } })
    await expectAnswerError(
      runNowAnswer(deps, input('other_project', { projectEntityId: OTHER_PROJECT })),
      400,
    )
    expect(deps.linkToProject).not.toHaveBeenCalled()
  })
})

describe('runNowAnswer: claim (NOW-AC15) and failure', () => {
  it('409 when the card is not pending any more, and nothing is written', async () => {
    const { deps, calls } = fakeDeps(card('do'), { claim: false })
    await expectAnswerError(runNowAnswer(deps, input('done')), 409)
    expect(names(calls)).toEqual(['loadCard', 'claim'])
    expect(deps.release).not.toHaveBeenCalled()
  })

  it('a double answer writes once: the second gets 409', async () => {
    const { deps } = fakeDeps(card('do'))
    const [a, b] = await Promise.allSettled([
      runNowAnswer(deps, input('done')),
      runNowAnswer(deps, input('done')),
    ])
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    expect((b as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
    expect(deps.setLifecycle).toHaveBeenCalledTimes(1)
    expect(deps.saveUndo).toHaveBeenCalledTimes(1)
  })

  it('an effect failure releases the claim and rethrows the same error', async () => {
    const { deps, calls } = fakeDeps(card('do'))
    const boom = new Error('graph is down')
    deps.setLifecycle.mockRejectedValueOnce(boom)
    await expect(runNowAnswer(deps, input('done'))).rejects.toBe(boom)
    expect(deps.release).toHaveBeenCalledTimes(1)
    expect(deps.release).toHaveBeenCalledWith(CARD)
    expect(names(calls).at(-1)).toBe('release')
    expect(deps.loadNext).not.toHaveBeenCalled()
  })

  it('a failure while recording undo state also releases the claim, before any effect', async () => {
    const { deps } = fakeDeps(card('do'))
    deps.snapshot.mockRejectedValueOnce(new Error('cannot read state'))
    await expect(runNowAnswer(deps, input('done'))).rejects.toThrow('cannot read state')
    expect(deps.release).toHaveBeenCalledWith(CARD)
    expect(deps.setLifecycle).not.toHaveBeenCalled()
  })

  it('a failed unblock capture (for example no credits) releases the claim and keeps the error type', async () => {
    const { deps } = fakeDeps(card('unblock'))
    const credits = Object.assign(new Error('Not enough credits'), { name: 'InsufficientCreditsError' })
    deps.captureStep.mockRejectedValueOnce(credits)
    await expect(runNowAnswer(deps, input('yes'))).rejects.toBe(credits)
    expect(deps.release).toHaveBeenCalledWith(CARD)
    expect(deps.linkToProject).not.toHaveBeenCalled()
  })

  it('the card can be answered again after a released failure', async () => {
    let claims = 0
    const { deps } = fakeDeps(card('do'))
    deps.claim.mockImplementation(async () => ++claims >= 1)
    deps.setLifecycle.mockRejectedValueOnce(new Error('once'))
    await expect(runNowAnswer(deps, input('done'))).rejects.toThrow('once')
    await expect(runNowAnswer(deps, input('done'))).resolves.toMatchObject({ state: 'card' })
  })

  it('when the next card cannot be loaded the answer stands and the state is error with the plain message', async () => {
    const { deps } = fakeDeps(card('do'))
    deps.loadNext.mockRejectedValueOnce(new Error('The model failed 3 times.'))
    const res = await runNowAnswer(deps, input('done'))
    expect(res).toEqual({ state: 'error', error: 'The model failed 3 times.', undo: { cardId: CARD } })
    expect(deps.release).not.toHaveBeenCalled()
  })

  it('a credits error while loading the next card is also reported as state error, answer standing', async () => {
    const { deps } = fakeDeps(card('sort'))
    deps.loadNext.mockRejectedValueOnce(
      Object.assign(new Error('Not enough credits'), { name: 'InsufficientCreditsError' }),
    )
    const res = await runNowAnswer(deps, input('keep'))
    expect(res).toMatchObject({ state: 'error', error: 'Not enough credits', undo: null })
  })
})

describe('answerNowCard (wiring)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the real dependencies for this user and now, and runs the answer', async () => {
    const { deps } = fakeDeps(card('sort'))
    buildDepsMock.mockReturnValue(deps)
    const res = await answerNowCard({ userId: USER, cardId: CARD, answer: 'keep', now: NOW })
    expect(buildDepsMock).toHaveBeenCalledWith(USER, NOW)
    expect(res.state).toBe('card')
    expect(deps.hideUntil).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

type UndoLoaded = Awaited<ReturnType<NowUndoDeps['loadCard']>>

function undoCard(over: Partial<NonNullable<UndoLoaded>> = {}): NonNullable<UndoLoaded> {
  return {
    id: CARD,
    status: 'answered',
    answer: 'done',
    answeredAt: new Date(NOW.getTime() - 2000),
    undoState,
    ...over,
  }
}

function fakeUndoDeps(loaded: UndoLoaded, over: { latest?: string | null; claim?: boolean } = {}) {
  const calls: Calls = []
  const log =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
    }
  const deps = {
    loadCard: vi.fn(async () => {
      calls.push(['loadCard'])
      return loaded
    }),
    latestAnsweredCardId: vi.fn(async () => {
      calls.push(['latestAnsweredCardId'])
      return over.latest === undefined ? CARD : over.latest
    }),
    claimUndo: vi.fn(async (...args: unknown[]) => {
      calls.push(['claimUndo', ...args])
      return over.claim ?? true
    }),
    reinstate: vi.fn(log('reinstate')),
    restoreMemberships: vi.fn(log('restoreMemberships')),
    restoreCategory: vi.fn(log('restoreCategory')),
    restoreLifecycle: vi.fn(log('restoreLifecycle')),
    restoreSequence: vi.fn(log('restoreSequence')),
    restoreProjectPointers: vi.fn(log('restoreProjectPointers')),
    loadNext: vi.fn(async () => {
      calls.push(['loadNext'])
      return nextCard
    }),
  } satisfies NowUndoDeps
  return { deps, calls }
}

describe('runNowUndo', () => {
  const undoInput = { cardId: CARD, now: NOW }

  it('restores everything recorded, in order, and returns the card again', async () => {
    const { deps, calls } = fakeUndoDeps(undoCard())
    const res = await runNowUndo(deps, undoInput)
    expect(names(calls)).toEqual([
      'loadCard',
      'latestAnsweredCardId',
      'claimUndo',
      'restoreMemberships',
      'restoreCategory',
      'restoreLifecycle',
      'restoreSequence',
      'restoreProjectPointers',
      'loadNext',
    ])
    expect(deps.restoreMemberships).toHaveBeenCalledWith(THOUGHT, undoState.memberships)
    expect(deps.restoreCategory).toHaveBeenCalledWith(THOUGHT, 'task')
    expect(deps.restoreLifecycle).toHaveBeenCalledWith(THOUGHT, 'open')
    expect(deps.restoreSequence).toHaveBeenCalledWith(PROJECT, ['a', 'b'])
    expect(deps.restoreProjectPointers).toHaveBeenCalledWith(undoState.projects[0])
    expect(res).toEqual(nextCard)
  })

  it('restores the sequence and pointers of every recorded project', async () => {
    const second = { ...undoState.projects[0], projectEntityId: OTHER_PROJECT, sequence: ['z'] }
    const { deps } = fakeUndoDeps(undoCard({ undoState: { ...undoState, projects: [undoState.projects[0], second] } }))
    await runNowUndo(deps, undoInput)
    expect(deps.restoreSequence).toHaveBeenCalledTimes(2)
    expect(deps.restoreSequence).toHaveBeenCalledWith(OTHER_PROJECT, ['z'])
    expect(deps.restoreProjectPointers).toHaveBeenCalledTimes(2)
  })

  it('404 when the card is not this user\'s', async () => {
    const { deps } = fakeUndoDeps(null)
    await expectAnswerError(runNowUndo(deps, undoInput), 404)
    expect(deps.claimUndo).not.toHaveBeenCalled()
  })

  it('404 for a card id that is not a uuid', async () => {
    const { deps } = fakeUndoDeps(undoCard())
    await expectAnswerError(runNowUndo(deps, { ...undoInput, cardId: 'x' }), 404)
    expect(deps.loadCard).not.toHaveBeenCalled()
  })

  it('works at exactly 6 seconds and 409s just after', async () => {
    const ok = fakeUndoDeps(undoCard({ answeredAt: new Date(NOW.getTime() - 6000) }))
    await expect(runNowUndo(ok.deps, undoInput)).resolves.toBeDefined()
    const late = fakeUndoDeps(undoCard({ answeredAt: new Date(NOW.getTime() - 6001) }))
    await expectAnswerError(runNowUndo(late.deps, undoInput), 409, /6 seconds/)
    expect(late.deps.claimUndo).not.toHaveBeenCalled()
    expect(late.deps.restoreLifecycle).not.toHaveBeenCalled()
  })

  it('409 when another card was answered after it (not the latest answer)', async () => {
    const { deps } = fakeUndoDeps(undoCard(), { latest: 'other-card' })
    await expectAnswerError(runNowUndo(deps, undoInput), 409, /latest/)
    expect(deps.claimUndo).not.toHaveBeenCalled()
  })

  it('409 when the card has no undo state (keep, not_now, unblock answers)', async () => {
    const { deps } = fakeUndoDeps(undoCard({ undoState: null, answer: 'keep' }))
    await expectAnswerError(runNowUndo(deps, undoInput), 409, /cannot be undone/)
    expect(deps.claimUndo).not.toHaveBeenCalled()
  })

  it('409 when the card is still pending (never answered)', async () => {
    const { deps } = fakeUndoDeps(undoCard({ status: 'pending', answeredAt: null, answer: null, undoState: null }))
    await expectAnswerError(runNowUndo(deps, undoInput), 409)
  })

  it('409 when a second Undo already took the claim, restoring nothing twice', async () => {
    const { deps } = fakeUndoDeps(undoCard(), { claim: false })
    await expectAnswerError(runNowUndo(deps, undoInput), 409)
    expect(deps.restoreMemberships).not.toHaveBeenCalled()
  })

  it('a restore failure puts the answered card back and rethrows', async () => {
    const { deps } = fakeUndoDeps(undoCard())
    const boom = new Error('graph is down')
    deps.restoreLifecycle.mockRejectedValueOnce(boom)
    await expect(runNowUndo(deps, undoInput)).rejects.toBe(boom)
    expect(deps.reinstate).toHaveBeenCalledWith(CARD, {
      answer: 'done',
      answeredAt: new Date(NOW.getTime() - 2000),
      undoState,
    })
    expect(deps.loadNext).not.toHaveBeenCalled()
  })
})

describe('undoNowCard (wiring)', () => {
  it('builds the real dependencies for this user and now', async () => {
    const { deps } = fakeUndoDeps(undoCard())
    buildDepsMock.mockReturnValue(deps)
    await undoNowCard({ userId: USER, cardId: CARD, now: NOW })
    expect(buildDepsMock).toHaveBeenCalledWith(USER, NOW)
    expect(deps.claimUndo).toHaveBeenCalledWith(CARD)
  })
})
