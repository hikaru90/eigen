import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  findMock: vi.fn(),
  judgeMock: vi.fn(),
  residualMock: vi.fn(),
  archiveThoughtMock: vi.fn(),
  archiveNoteMock: vi.fn(),
  editMock: vi.fn(),
  removeNoteDetailMock: vi.fn(),
  loadResultMock: vi.fn(),
  logActivityCallMock: vi.fn(),
  forgetFactsMock: vi.fn(),
  removeFactDetailMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: () => ({ tag: 'db' }) }))
vi.mock('$lib/server/capture/find-forget-hits', () => ({ findForgetHits: m.findMock }))
vi.mock('$lib/server/capture/judge-forget-hits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/capture/judge-forget-hits')>()
  return { ...actual, judgeForgetHits: m.judgeMock, judgeForgetResidual: m.residualMock }
})
vi.mock('$lib/server/capture/remove-note-detail', () => ({
  removeDetailFromNote: m.removeNoteDetailMock,
}))
vi.mock('$lib/server/text-files/service', () => ({ archiveTextFile: m.archiveNoteMock }))
vi.mock('$lib/server/memory/lifecycle', () => ({ archiveThoughtForUser: m.archiveThoughtMock }))
vi.mock('$lib/server/capture/service', () => ({ editStoredThought: m.editMock }))
vi.mock('$lib/server/capture/capture-result', () => ({
  loadThoughtCaptureResult: m.loadResultMock,
}))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: m.logActivityCallMock }))
vi.mock('$lib/server/facts/user-fact-lifecycle', () => ({ forgetUserFacts: m.forgetFactsMock }))
vi.mock('$lib/server/facts/remove-fact-detail', () => ({
  removeDetailFromFact: m.removeFactDetailMock,
}))

import type { ForgetHit } from './find-forget-hits'
import type { JudgedForgetHit } from './judge-forget-hits'
import { applyForgetRequest, FORGET_EDIT_LABEL } from './apply-forget-request'

const CAPTURE_AT = new Date('2026-06-02T10:00:00.000Z')
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const N1 = '33333333-3333-4333-8333-333333333333'
const N2 = '44444444-4444-4444-8444-444444444444'
const CAPTURE = '99999999-9999-4999-8999-999999999999'

const thoughtHit = (id: string, text = `text of ${id}`): ForgetHit => ({
  kind: 'thought',
  id,
  text,
  category: 'observation',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  score: 0.9,
})
const noteHit = (id: string, ordinals = [2]): ForgetHit => ({
  kind: 'note',
  id,
  title: 'Diary',
  text: `excerpt of ${id}`,
  matchedOrdinals: ordinals,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  score: 0.8,
})

const F1 = '55555555-5555-4555-8555-555555555555'
const F2 = '66666666-6666-4666-8666-666666666666'
const factHit = (id: string, text = `statement of ${id}`): ForgetHit => ({
  kind: 'fact',
  id,
  text,
  subject: 'the user',
  factKind: 'habit',
  inferred: false,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  score: 0.85,
})

const removeAll = (hit: ForgetHit, confidence = 0.95): JudgedForgetHit => ({
  hit,
  action: 'remove_all',
  confidence,
})
const removeDetail = (hit: ForgetHit, confidence = 0.9): JudgedForgetHit => ({
  hit,
  action: 'remove_detail',
  confidence,
})
const keep = (hit: ForgetHit, confidence = 0.95): JudgedForgetHit => ({
  hit,
  action: 'keep',
  confidence,
})

/**
 * Arrange retrieval + judge in one go. The first search finds the hits; the residual search after the
 * removals (when one happens) finds `remaining` — nothing by default, every removed hit gone.
 */
function arrange(judged: JudgedForgetHit[], remaining: ForgetHit[] = []) {
  m.findMock
    .mockResolvedValueOnce({ phrases: ['p'], hits: judged.map((j) => j.hit) })
    .mockResolvedValue({ phrases: ['p'], hits: remaining })
  m.judgeMock.mockResolvedValue(judged)
  m.residualMock.mockImplementation(
    async (input: { hits: ForgetHit[] }) =>
      input.hits.map((hit) => ({ hit, stillStates: false, probability: 0.9 })),
  )
}

function run() {
  return applyForgetRequest({
    userId: 'u1',
    captureThoughtId: CAPTURE,
    captureCreatedAt: CAPTURE_AT,
    request: 'Please forget that I like surfing',
  })
}

function auditContexts(): string[] {
  return m.logActivityCallMock.mock.calls.map((c) => (c[2] as { context: string }).context)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.logActivityCallMock.mockResolvedValue(undefined)
  m.archiveThoughtMock.mockResolvedValue({ ok: true })
  m.archiveNoteMock.mockResolvedValue(true)
  m.removeNoteDetailMock.mockResolvedValue('edited')
  m.forgetFactsMock.mockImplementation(async (_u: string, ids: string[]) => ids)
  m.removeFactDetailMock.mockResolvedValue('edited')
  m.loadResultMock.mockImplementation(async (_u: string, id: string) => ({
    id,
    normalizedText: `text of ${id}`,
    lifecycleStatus: 'open',
  }))
})

describe('applyForgetRequest (S2b: find first, decide per hit)', () => {
  it("finds hits with Ask's retrieval restricted to items stored BEFORE the forget capture, and judges them all with the request", async () => {
    arrange([keep(thoughtHit(T1))])
    await run()
    expect(m.findMock).toHaveBeenCalledWith({
      userId: 'u1',
      request: 'Please forget that I like surfing',
      createdBefore: CAPTURE_AT,
    })
    expect(m.judgeMock).toHaveBeenCalledWith({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      hits: [thoughtHit(T1)],
    })
  })

  describe('thoughts', () => {
    it('remove_all archives the thought through the lifecycle service', async () => {
      arrange([removeAll(thoughtHit(T1))])
      const outcome = await run()
      expect(m.archiveThoughtMock).toHaveBeenCalledWith('u1', T1)
      expect(m.editMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ status: 'applied', archived: [T1], edited: [], unresolved: [] })
    })

    it('remove_detail edits only the detail through the natural-language edit service, with a generic edit label', async () => {
      arrange([removeDetail(thoughtHit(T1))])
      m.editMock.mockResolvedValue({
        ok: true,
        thought: { id: T1, normalizedText: 'I work as a nurse' },
        editSummary: 'x',
      })

      const outcome = await run()

      expect(m.editMock).toHaveBeenCalledTimes(1)
      const [userId, thoughtId, editRequest, options] = m.editMock.mock.calls[0]
      expect([userId, thoughtId]).toEqual(['u1', T1])
      expect(editRequest).toMatch(/^Remove only/)
      // the chat edit is told what to forget by the user's own request; nothing else decided a "detail"
      expect(editRequest).toContain('Please forget that I like surfing')
      // the stored edit metadata gets the generic label, never the forgotten detail
      expect(options).toEqual({ editLabel: FORGET_EDIT_LABEL })
      expect(FORGET_EDIT_LABEL).not.toMatch(/surf/i)
      expect(outcome).toMatchObject({ status: 'applied', archived: [], edited: [T1] })
    })

    it('a remove_detail edit that leaves the text unchanged fails loudly and the instruction is not archived', async () => {
      arrange([removeDetail(thoughtHit(T1))])
      m.loadResultMock.mockResolvedValue({ id: T1, normalizedText: 'surfing and nursing', lifecycleStatus: 'open' })
      m.editMock.mockResolvedValue({
        ok: true,
        thought: { id: T1, normalizedText: 'surfing and nursing' },
        editSummary: 'nothing',
      })
      await expect(run()).rejects.toThrow(/unchanged/)
      expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)
    })

    it('skips a thought that is no longer active (archived since retrieval): it counts as neither removed nor unresolved', async () => {
      arrange([removeAll(thoughtHit(T1)), removeAll(thoughtHit(T2))])
      m.loadResultMock.mockImplementation(async (_u: string, id: string) => ({
        id,
        normalizedText: 'x',
        lifecycleStatus: id === T1 ? 'archived' : 'open',
      }))
      const outcome = await run()
      expect(m.archiveThoughtMock.mock.calls).toEqual([
        ['u1', T2],
        ['u1', CAPTURE],
      ])
      expect(outcome.archived).toEqual([T2])
    })
  })

  describe('notes (passage hits)', () => {
    it('remove_detail edits the matched passages of the note through the note edit path', async () => {
      arrange([removeDetail(noteHit(N1, [3, 4]))])
      const outcome = await run()
      expect(m.removeNoteDetailMock).toHaveBeenCalledWith({
        userId: 'u1',
        noteId: N1,
        forgetRequest: 'Please forget that I like surfing',
        matchedOrdinals: [3, 4],
      })
      expect(m.archiveNoteMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ status: 'applied', notesEdited: [N1], notesArchived: [] })
    })

    it('remove_all archives the whole note (never a hard delete)', async () => {
      arrange([removeAll(noteHit(N1))])
      const outcome = await run()
      expect(m.archiveNoteMock).toHaveBeenCalledWith('u1', N1)
      expect(m.removeNoteDetailMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ status: 'applied', notesArchived: [N1], notesEdited: [] })
    })

    it('a note emptied by the detail removal is reported as archived', async () => {
      arrange([removeDetail(noteHit(N1))])
      m.removeNoteDetailMock.mockResolvedValue('archived')
      expect(await run()).toMatchObject({ notesArchived: [N1], notesEdited: [] })
    })

    it('a note that is gone (archived or deleted since retrieval) counts as neither removed nor unresolved', async () => {
      arrange([removeAll(noteHit(N1)), removeDetail(noteHit(N2))])
      m.archiveNoteMock.mockResolvedValue(false)
      m.removeNoteDetailMock.mockResolvedValue('gone')
      const outcome = await run()
      expect(outcome).toMatchObject({
        status: 'nothing_removed',
        notesArchived: [],
        notesEdited: [],
        unresolved: [],
        instruction: 'kept',
      })
    })
  })

  describe('facts (docs/planning/user-facts-layer.md)', () => {
    it('remove_all forgets the fact: it leaves every search at once and the instruction goes with it', async () => {
      arrange([removeAll(factHit(F1))])
      const outcome = await run()
      expect(m.forgetFactsMock).toHaveBeenCalledWith('u1', [F1])
      expect(m.removeFactDetailMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({
        status: 'applied',
        factsForgotten: [F1],
        factsEdited: [],
        instruction: 'archived',
      })
      expect(m.archiveThoughtMock).toHaveBeenCalledWith('u1', CAPTURE)
    })

    it('remove_detail rewrites the statement without the detail', async () => {
      arrange([removeDetail(factHit(F1))])
      const outcome = await run()
      expect(m.removeFactDetailMock).toHaveBeenCalledWith({
        userId: 'u1',
        factId: F1,
        forgetRequest: 'Please forget that I like surfing',
      })
      expect(m.forgetFactsMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ status: 'applied', factsEdited: [F1], factsForgotten: [] })
    })

    it('a detail removal that leaves nothing of the fact counts as forgotten', async () => {
      arrange([removeDetail(factHit(F1))])
      m.removeFactDetailMock.mockResolvedValue('forgotten')
      expect(await run()).toMatchObject({ factsForgotten: [F1], factsEdited: [] })
    })

    it('a fact that is gone (archived with its source, or forgotten since retrieval) counts as neither removed nor unresolved', async () => {
      arrange([removeAll(factHit(F1)), removeDetail(factHit(F2))])
      m.forgetFactsMock.mockResolvedValue([])
      m.removeFactDetailMock.mockResolvedValue('gone')
      expect(await run()).toMatchObject({
        status: 'nothing_removed',
        factsForgotten: [],
        factsEdited: [],
        unresolved: [],
        instruction: 'kept',
      })
    })

    it('a fact below the confidence gate is left untouched and recorded as unresolved by id', async () => {
      arrange([removeAll(factHit(F1), 0.6), removeAll(thoughtHit(T1))])
      const outcome = await run()
      expect(m.forgetFactsMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({
        status: 'partial',
        unresolved: [{ kind: 'fact', id: F1 }],
        instruction: 'kept',
      })
    })

    it('a kept fact is left alone', async () => {
      arrange([keep(factHit(F1))])
      const outcome = await run()
      expect(m.forgetFactsMock).not.toHaveBeenCalled()
      expect(m.removeFactDetailMock).not.toHaveBeenCalled()
      expect(outcome.status).toBe('nothing_removed')
    })

    it('audits the fact decisions and removals by id, never by text', async () => {
      arrange([removeAll(factHit(F1, 'Drinks three coffees a day'))])
      await run()
      expect(auditContexts().some((c) => c.includes(`fact_forgotten=${F1}`))).toBe(true)
      expect(auditContexts().some((c) => c.includes(`hit=fact:${F1}`))).toBe(true)
      expect(auditContexts().join('\n')).not.toContain('coffees')
    })

    it('a failing fact removal propagates and the instruction stays', async () => {
      arrange([removeDetail(factHit(F1))])
      m.removeFactDetailMock.mockRejectedValue(new Error('fact detail removal: response is not valid JSON'))
      await expect(run()).rejects.toThrow(/fact detail removal/)
      expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)
    })
  })

  describe('confidence gate and the instruction', () => {
    it('mixed confident + uncertain hits: the confident removal is applied, the uncertain one is left untouched and recorded, the instruction is kept', async () => {
      arrange([
        removeAll(thoughtHit(T1), 0.95),
        removeDetail(thoughtHit(T2), 0.6),
        removeAll(noteHit(N1), 0.79),
      ])
      const outcome = await run()

      expect(m.archiveThoughtMock.mock.calls).toEqual([['u1', T1]])
      expect(m.editMock).not.toHaveBeenCalled()
      expect(m.archiveNoteMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({
        status: 'partial',
        archived: [T1],
        unresolved: [
          { kind: 'thought', id: T2 },
          { kind: 'note', id: N1 },
        ],
        instruction: 'kept',
      })
      // kept: the forget capture stays an active thought
      expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)
    })

    it('exactly the gate (0.8) is confident', async () => {
      arrange([removeAll(thoughtHit(T1), 0.8)])
      expect(await run()).toMatchObject({ status: 'applied', archived: [T1] })
    })

    it('nothing confident: unresolved only, nothing removed, the instruction is kept', async () => {
      arrange([removeAll(thoughtHit(T1), 0.5)])
      const outcome = await run()
      expect(m.archiveThoughtMock).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({
        status: 'unresolved',
        unresolved: [{ kind: 'thought', id: T1 }],
        instruction: 'kept',
      })
    })

    it('a hesitant keep is unresolved too (the judge was unsure the item is unrelated)', async () => {
      arrange([keep(thoughtHit(T1), 0.55)])
      expect(await run()).toMatchObject({
        status: 'unresolved',
        unresolved: [{ kind: 'thought', id: T1 }],
        instruction: 'kept',
      })
    })

    it('nothing found: no judge call, the instruction is kept and Ask will see it', async () => {
      m.findMock.mockResolvedValue({ phrases: ['p'], hits: [] })
      const outcome = await run()
      expect(m.judgeMock).not.toHaveBeenCalled()
      expect(m.archiveThoughtMock).not.toHaveBeenCalled()
      expect(outcome).toEqual({
        status: 'nothing_found',
        archived: [],
        edited: [],
        notesArchived: [],
        notesEdited: [],
        factsForgotten: [],
        factsEdited: [],
        unresolved: [],
        instruction: 'kept',
      })
      expect(auditContexts().at(-1)).toContain('status=nothing_found')
    })

    it('every hit confidently kept: nothing is removed, the instruction is kept', async () => {
      arrange([keep(thoughtHit(T1)), keep(noteHit(N1))])
      const outcome = await run()
      expect(outcome).toMatchObject({ status: 'nothing_removed', instruction: 'kept', unresolved: [] })
      expect(m.archiveThoughtMock).not.toHaveBeenCalled()
    })

    it('everything removed and nothing unresolved: the instruction is archived, last, after the removals', async () => {
      arrange([removeAll(thoughtHit(T1)), removeAll(noteHit(N1)), keep(thoughtHit(T2))])
      const calls: string[] = []
      m.archiveThoughtMock.mockImplementation(async (_u: string, id: string) => {
        calls.push(`thought:${id}`)
        return { ok: true }
      })
      m.archiveNoteMock.mockImplementation(async (_u: string, id: string) => {
        calls.push(`note:${id}`)
        return true
      })

      const outcome = await run()

      expect(calls).toEqual([`thought:${T1}`, `note:${N1}`, `thought:${CAPTURE}`])
      expect(outcome).toMatchObject({ status: 'applied', instruction: 'archived' })
    })

    it('a failing removal propagates (the retry ladder owns recovery) and the instruction stays', async () => {
      arrange([removeAll(thoughtHit(T1))])
      m.archiveThoughtMock.mockResolvedValue({ ok: false })
      await expect(run()).rejects.toThrow(new RegExp(T1))
      expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)
    })

    it('a judge failure propagates and nothing is removed', async () => {
      m.findMock.mockResolvedValue({ phrases: ['p'], hits: [thoughtHit(T1)] })
      m.judgeMock.mockRejectedValue(new Error('gateway 502'))
      await expect(run()).rejects.toThrow(/gateway 502/)
      expect(m.archiveThoughtMock).not.toHaveBeenCalled()
    })

    it('a retrieval failure propagates', async () => {
      m.findMock.mockRejectedValue(new Error('embedding down'))
      await expect(run()).rejects.toThrow(/embedding down/)
      expect(m.judgeMock).not.toHaveBeenCalled()
    })
  })

  it('writes one audit row per hit decision and per action plus a summary: ids, actions, confidences and counts only, never text', async () => {
    const secret = 'HUNTER2-password-hint'
    arrange([
      removeAll(thoughtHit(T1, `my password hint is ${secret}`), 0.97),
      removeDetail(thoughtHit(T2, `${secret} and nursing`), 0.92),
      keep(noteHit(N1), 0.9),
      removeDetail(noteHit(N2), 0.4),
    ])
    m.editMock.mockResolvedValue({
      ok: true,
      thought: { id: T2, normalizedText: 'nursing' },
      editSummary: 's',
    })

    await run()

    expect(auditContexts()).toEqual([
      `forget capture=${CAPTURE} hit=thought:${T1} action=remove_all confidence=0.97`,
      `forget capture=${CAPTURE} hit=thought:${T2} action=remove_detail confidence=0.92`,
      `forget capture=${CAPTURE} hit=note:${N1} action=keep confidence=0.90`,
      `forget capture=${CAPTURE} hit=note:${N2} action=remove_detail confidence=0.40`,
      `forget capture=${CAPTURE} archived=${T1}`,
      `forget capture=${CAPTURE} edited=${T2}`,
      `forget capture=${CAPTURE} unresolved=note:${N2}`,
      `forget capture=${CAPTURE} status=partial archived=1 edited=1 notes_archived=0 notes_edited=0 facts_forgotten=0 facts_edited=0 unresolved=1 instruction=kept`,
    ])
    for (const call of m.logActivityCallMock.mock.calls) {
      expect(call[1]).toBe('u1')
      expect(call[2]).toMatchObject({ provider: 'memory', operation: 'forget_request', baseCostUsd: 0 })
      expect(JSON.stringify(call[2])).not.toContain(secret)
    }
  })
})

describe('applyForgetRequest: the residual check (forget_residual, Jev) before the instruction goes', () => {
  const residual = (hit: ForgetHit, stillStates: boolean, probability = 0.9) => ({
    hit,
    stillStates,
    probability,
  })

  it('after everything was removed it searches again with the first pass phrases and asks Jev about every hit that is still found', async () => {
    const left = thoughtHit(T2, 'I surf on weekends')
    arrange([removeAll(thoughtHit(T1))], [left])

    const outcome = await run()

    expect(m.findMock).toHaveBeenCalledTimes(2)
    expect(m.findMock.mock.calls[1]![0]).toEqual({
      userId: 'u1',
      request: 'Please forget that I like surfing',
      createdBefore: CAPTURE_AT,
      phrases: ['p'],
    })
    expect(m.residualMock).toHaveBeenCalledTimes(1)
    expect(m.residualMock).toHaveBeenCalledWith({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      hits: [left],
    })
    // every answer is no: the instruction goes
    expect(outcome).toMatchObject({ status: 'applied', instruction: 'archived', unresolved: [] })
    expect(m.archiveThoughtMock).toHaveBeenLastCalledWith('u1', CAPTURE)
  })

  it('a hit that still states the forgotten thing keeps the instruction: partial, the hit recorded by id, nothing archived last', async () => {
    const left = factHit(F2, 'Surfs on weekends')
    arrange([removeAll(thoughtHit(T1))], [left, thoughtHit(T2)])
    m.residualMock.mockResolvedValue([residual(left, true), residual(thoughtHit(T2), false)])

    const outcome = await run()

    expect(outcome).toMatchObject({
      status: 'partial',
      archived: [T1],
      unresolved: [{ kind: 'fact', id: F2 }],
      instruction: 'kept',
    })
    expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)
    expect(auditContexts()).toContain(`forget capture=${CAPTURE} residual=fact:${F2} still_states=yes`)
    expect(auditContexts()).toContain(`forget capture=${CAPTURE} residual=thought:${T2} still_states=no`)
    expect(auditContexts().at(-1)).toContain('status=partial')
    expect(auditContexts().at(-1)).toContain('unresolved=1 instruction=kept')
  })

  it('the removed fact only is not "done": the thought that says the same still blocks the archive', async () => {
    // the root cause of the 0/8 forget slice: done was declared after removing only the fact
    const sameThing = thoughtHit(T1, 'I do not drink coffee any more, I quit last month')
    arrange([removeAll(factHit(F1))], [sameThing])
    m.residualMock.mockResolvedValue([residual(sameThing, true, 0.85)])
    const outcome = await run()
    expect(outcome).toMatchObject({
      status: 'partial',
      factsForgotten: [F1],
      unresolved: [{ kind: 'thought', id: T1 }],
      instruction: 'kept',
    })
  })

  it('nothing is found any more: no Jev call, the instruction goes', async () => {
    arrange([removeAll(thoughtHit(T1))], [])
    const outcome = await run()
    expect(m.findMock).toHaveBeenCalledTimes(2)
    expect(m.residualMock).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ status: 'applied', instruction: 'archived' })
  })

  it('no residual search when the instruction stays anyway (nothing removed, a hit unresolved, nothing found)', async () => {
    arrange([keep(thoughtHit(T1))])
    await run()
    arrange([removeAll(thoughtHit(T1), 0.5)])
    await run()
    m.findMock.mockReset()
    m.findMock.mockResolvedValue({ phrases: ['p'], hits: [] })
    await run()
    expect(m.residualMock).not.toHaveBeenCalled()
    // one search per run: the three runs above searched once each
    expect(m.findMock).toHaveBeenCalledTimes(1)
  })

  it('a failing residual search or Jev call propagates and the instruction is not archived (the retry ladder owns recovery)', async () => {
    arrange([removeAll(thoughtHit(T1))], [thoughtHit(T2)])
    m.residualMock.mockRejectedValue(new Error('jev down'))
    await expect(run()).rejects.toThrow('jev down')
    expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)

    m.findMock.mockReset()
    m.findMock
      .mockResolvedValueOnce({ phrases: ['p'], hits: [thoughtHit(T1)] })
      .mockRejectedValueOnce(new Error('embedding down'))
    m.judgeMock.mockResolvedValue([removeAll(thoughtHit(T1))])
    await expect(run()).rejects.toThrow('embedding down')
    expect(m.archiveThoughtMock).not.toHaveBeenCalledWith('u1', CAPTURE)
  })

  it('the residual audit rows hold ids and the answer only, never text', async () => {
    const secret = 'HUNTER2-password-hint'
    const left = thoughtHit(T2, `my password hint is ${secret}`)
    arrange([removeAll(thoughtHit(T1))], [left])
    m.residualMock.mockResolvedValue([residual(left, true)])
    await run()
    expect(auditContexts().join('\n')).not.toContain(secret)
    expect(auditContexts()).toContain(`forget capture=${CAPTURE} residual=thought:${T2} still_states=yes`)
  })
})
