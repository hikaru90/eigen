import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runEnforcedBoundedDecisionsMock, llmChatCompletionMock } = vi.hoisted(() => ({
  runEnforcedBoundedDecisionsMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
}))

// Every fact decision is Jev's, asked through the plane (mocked at its boundary): the chat gateway
// must never be reached from this module, and no spec may reach the real Decisions API.
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: runEnforcedBoundedDecisionsMock }
})
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import type { FactCandidate } from './parse-fact-extraction'
import {
  FACT_DECISION_REFERENCE_MAX_CHARS,
  FACT_KEEP_CRITERIA,
  FACT_KIND_CRITERIA,
  FACT_SUBJECT_CRITERIA,
  decideFactCandidates,
  type NearestFact,
} from './decide-user-facts'
import { FACT_KINDS, SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'

const AT = new Date('2026-06-02T08:30:00.000Z')
const E_MIA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const COFFEE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const POOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const candidate = (over: Partial<FactCandidate> = {}): FactCandidate => ({
  statement: 'Swims at the local pool',
  subjectLabel: null,
  entityId: null,
  inferred: false,
  identifier: null,
  ...over,
})

const stored = (over: Partial<NearestFact> = {}): NearestFact => ({
  id: COFFEE,
  subjectKind: 'user',
  subjectLabel: null,
  kind: 'habit',
  statement: 'Drinks three coffees a day',
  inferred: false,
  asOf: new Date('2026-03-01T00:00:00Z'),
  ...over,
})

type Answer = { choice: string; probabilities: Record<string, number> }
type Script = Record<string, Answer>

const answer = (choice: string, probabilities: Record<string, number>): Answer => ({
  choice,
  probabilities,
})
const KEEP = answer('keep', { keep: 0.93, drop: 0.07 })
const USER = answer('user', { user: 0.9, person: 0.1 })
const ACTIVITY = answer('activity', { activity: 0.8, habit: 0.2 })

type Spec = {
  decisionKind: string
  id: string
  subjectRef?: string
  question: { type: string; instructions: string; criteria: Record<string, string> }
  llmChoice: string | null
}
type PlaneCall = { userId: string; surface: string; state: string; specs: Spec[] }

/** Jev answers by spec id; every id of the call must be scripted (an unscripted question is a bug). */
function jev(script: Script, opts: { omit?: string[] } = {}) {
  runEnforcedBoundedDecisionsMock.mockImplementation(async (input: PlaneCall) => {
    const out = new Map<string, unknown>()
    for (const spec of input.specs) {
      if (opts.omit?.includes(spec.id)) continue
      const scripted = script[spec.id]
      if (!scripted) throw new Error(`unscripted question ${spec.id}`)
      out.set(spec.id, {
        type: 'choice',
        choice: scripted.choice,
        probabilities: scripted.probabilities,
        confidence: scripted.probabilities[scripted.choice],
      })
    }
    return out
  })
}

const call = () => runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as PlaneCall

const decide = (
  candidates: FactCandidate[],
  nearest: NearestFact[][] = candidates.map(() => []),
  over: { text?: string; referenceText?: string | null } = {},
) =>
  decideFactCandidates({
    userId: 'u1',
    text: over.text ?? 'I swam at the local pool again this morning',
    referenceText: over.referenceText ?? null,
    capturedAt: AT,
    candidates,
    nearest,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the Jev request: ONE call, four question kinds per candidate', () => {
  it('asks fact_keep, fact_subject and fact_kind per candidate in one fact_derivation call, with the capture as state', async () => {
    jev({
      'fact_keep:c1': KEEP,
      'fact_subject:c1': USER,
      'fact_kind:c1': ACTIVITY,
      'fact_keep:c2': KEEP,
      'fact_subject:c2': answer('person', { person: 0.9, user: 0.1 }),
      'fact_kind:c2': answer('health', { health: 0.9, habit: 0.1 }),
    })
    await decide([
      candidate(),
      candidate({ statement: 'Mia (friend) keeps getting headaches', subjectLabel: 'Mia (friend)' }),
    ])

    expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    const c = call()
    expect(c.userId).toBe('u1')
    expect(c.surface).toBe('fact_derivation')
    expect(c.specs.map((s) => [s.decisionKind, s.id, s.subjectRef])).toEqual([
      ['fact_keep', 'fact_keep:c1', 'c1'],
      ['fact_subject', 'fact_subject:c1', 'c1'],
      ['fact_kind', 'fact_kind:c1', 'c1'],
      ['fact_keep', 'fact_keep:c2', 'c2'],
      ['fact_subject', 'fact_subject:c2', 'c2'],
      ['fact_kind', 'fact_kind:c2', 'c2'],
    ])
    for (const spec of c.specs) {
      expect(spec.question.type).toBe('choice')
      expect(spec.llmChoice).toBeNull()
    }
    expect(c.state).toContain('Capture written on: 2026-06-02')
    expect(c.state).toContain('I swam at the local pool again this morning')
  })

  it('puts each candidate statement and its proposed subject into its questions', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    await decide([candidate({ subjectLabel: 'Mia (friend)', inferred: true })])
    const byId = Object.fromEntries(call().specs.map((s) => [s.id, s.question.instructions]))
    for (const id of ['fact_keep:c1', 'fact_subject:c1', 'fact_kind:c1']) {
      expect(byId[id]).toContain('Swims at the local pool')
    }
    expect(byId['fact_keep:c1']).toContain('Mia (friend)')
    expect(byId['fact_keep:c1']).toMatch(/implied by the capture rather than stated/)
    expect(byId['fact_subject:c1']).toContain('Mia (friend)')
  })

  it('a candidate about the author shows "the author of the capture" instead of a person label', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    await decide([candidate()])
    const keep = call().specs[0]!.question.instructions
    expect(keep).toMatch(/author of the capture/)
    expect(keep).not.toMatch(/implied by the capture/)
  })

  it('fact_keep criteria: keep = a complete, personally relevant fact about a person; drop = fragment, trivia, document topic, writing-task note, request', () => {
    expect(Object.keys(FACT_KEEP_CRITERIA)).toEqual(['keep', 'drop'])
    expect(FACT_KEEP_CRITERIA.keep).toMatch(/complete statement about one person/i)
    expect(FACT_KEEP_CRITERIA.keep).toMatch(/change how an assistant should treat or advise/i)
    expect(FACT_KEEP_CRITERIA.keep).toMatch(/implied by the capture/i)
    for (const word of [
      /sentence fragment/i,
      /trivia/i,
      /topic or content of a document/i,
      /writing or work task/i,
      /request or instruction to the assistant/i,
      /general knowledge/i,
    ]) {
      expect(FACT_KEEP_CRITERIA.drop).toMatch(word)
    }
  })

  it('fact_subject criteria: the author (user) or someone else (person)', () => {
    expect(Object.keys(FACT_SUBJECT_CRITERIA)).toEqual(['user', 'person'])
    expect(FACT_SUBJECT_CRITERIA.user).toMatch(/author of the capture/i)
    expect(FACT_SUBJECT_CRITERIA.person).toMatch(/friend, relative, colleague/i)
    expect(FACT_SUBJECT_CRITERIA.person).toMatch(/not about the user/i)
  })

  it('fact_kind criteria: exactly the fact catalog, each kind defined', () => {
    expect(Object.keys(FACT_KIND_CRITERIA)).toEqual([...FACT_KINDS])
    for (const text of Object.values(FACT_KIND_CRITERIA)) expect(text.length).toBeGreaterThan(15)
  })

  it('the criteria of the three kinds are what the questions carry', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    await decide([candidate()])
    const byKind = Object.fromEntries(call().specs.map((s) => [s.decisionKind, s.question.criteria]))
    expect(byKind.fact_keep).toEqual(FACT_KEEP_CRITERIA)
    expect(byKind.fact_subject).toEqual(FACT_SUBJECT_CRITERIA)
    expect(byKind.fact_kind).toEqual(FACT_KIND_CRITERIA)
  })

  it('the state carries the reference text (excerpt, bounded) so a document-sourced candidate can be judged', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    await decide([candidate()], undefined, {
      referenceText: 'Dear Prof. Lee, ' + 'Ω'.repeat(FACT_DECISION_REFERENCE_MAX_CHARS + 500),
    })
    const state = call().state
    expect(state).toContain('Dear Prof. Lee')
    expect(state.match(/Ω/g)!.length).toBeLessThan(FACT_DECISION_REFERENCE_MAX_CHARS)
    expect(state).toMatch(/Reference text that came with the capture/)
  })

  it('no candidates: no call, nothing decided', async () => {
    const out = await decide([])
    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
    expect(out).toEqual({
      operations: [],
      candidateIndexes: [],
      droppedByJudge: 0,
      droppedLowConfidence: 0,
    })
  })

  it('the chat gateway is never reached', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    await decide([candidate()])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })
})

describe('fact_keep drives what is stored', () => {
  it('keeps a complete personal fact: stored with Jev\'s probability as its confidence', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    const out = await decide([candidate({ inferred: true })])
    expect(out.operations).toEqual([
      {
        op: 'add',
        fact: {
          subject: { kind: 'user' },
          kind: 'activity',
          statement: 'Swims at the local pool',
          confidence: 0.93,
          inferred: true,
          identifier: null,
        },
      },
    ])
    expect(out.candidateIndexes).toEqual([0])
    expect(out.droppedByJudge).toBe(0)
    expect(out.droppedLowConfidence).toBe(0)
  })

  it('a fragment ("The user.") and a piece of trivia are dropped by Jev: nothing stored, counted', async () => {
    jev({
      'fact_keep:c1': answer('drop', { drop: 0.96, keep: 0.04 }),
      'fact_subject:c1': USER,
      'fact_kind:c1': ACTIVITY,
      'fact_keep:c2': answer('drop', { drop: 0.9, keep: 0.1 }),
      'fact_subject:c2': USER,
      'fact_kind:c2': ACTIVITY,
      'fact_keep:c3': KEEP,
      'fact_subject:c3': USER,
      'fact_kind:c3': ACTIVITY,
    })
    const out = await decide([
      candidate({ statement: 'The user.' }),
      candidate({ statement: 'The oolong has a faint scent of orchids' }),
      candidate({ statement: 'Swims at the local pool' }),
    ])
    expect(out.operations).toHaveLength(1)
    expect(out.operations[0]).toMatchObject({ op: 'add', fact: { statement: 'Swims at the local pool' } })
    expect(out.candidateIndexes).toEqual([2])
    expect(out.droppedByJudge).toBe(2)
  })

  it('below the 0.7 gate even a "keep" is not stored (Jev probability is the confidence): counted apart', async () => {
    jev({
      'fact_keep:c1': answer('keep', { keep: 0.55, drop: 0.45 }),
      'fact_subject:c1': USER,
      'fact_kind:c1': ACTIVITY,
      'fact_keep:c2': answer('keep', { keep: 0.7, drop: 0.3 }),
      'fact_subject:c2': USER,
      'fact_kind:c2': ACTIVITY,
    })
    const out = await decide([candidate({ statement: 'Maybe surfs' }), candidate()])
    expect(out.operations).toHaveLength(1)
    expect(out.operations[0]).toMatchObject({ fact: { statement: 'Swims at the local pool', confidence: 0.7 } })
    expect(out.droppedLowConfidence).toBe(1)
    expect(out.droppedByJudge).toBe(0)
  })
})

describe('fact_subject drives who a fact is about', () => {
  it('person: the proposed label and the graph entity become the subject, never the user', async () => {
    jev({
      'fact_keep:c1': KEEP,
      'fact_subject:c1': answer('person', { person: 0.95, user: 0.05 }),
      'fact_kind:c1': answer('health', { health: 0.9, habit: 0.1 }),
    })
    const out = await decide([
      candidate({
        statement: 'Mia (friend) keeps getting headaches',
        subjectLabel: 'Mia (friend)',
        entityId: E_MIA,
      }),
    ])
    expect(out.operations[0]).toMatchObject({
      op: 'add',
      fact: {
        subject: { kind: 'person', label: 'Mia (friend)', entityId: E_MIA },
        kind: 'health',
      },
    })
  })

  it('user: the fact is the user\'s even when the model proposed a label', async () => {
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY })
    const out = await decide([candidate({ subjectLabel: 'Mia', entityId: E_MIA })])
    expect(out.operations[0]).toMatchObject({ fact: { subject: { kind: 'user' } } })
  })

  it('person without a label to attribute it to fails loud instead of storing it under the user', async () => {
    jev({
      'fact_keep:c1': KEEP,
      'fact_subject:c1': answer('person', { person: 0.9, user: 0.1 }),
      'fact_kind:c1': ACTIVITY,
    })
    await expect(decide([candidate({ subjectLabel: null })])).rejects.toThrow(
      /candidate #1: Jev says the fact is about a person but no subject label was proposed/,
    )
  })

  it('a dropped candidate never trips the subject check', async () => {
    jev({
      'fact_keep:c1': answer('drop', { drop: 0.9, keep: 0.1 }),
      'fact_subject:c1': answer('person', { person: 0.9, user: 0.1 }),
      'fact_kind:c1': ACTIVITY,
    })
    await expect(decide([candidate({ subjectLabel: null })])).resolves.toMatchObject({
      operations: [],
      droppedByJudge: 1,
    })
  })
})

describe('fact_kind drives the kind', () => {
  it.each(FACT_KINDS)('stores kind %s as Jev answered it', async (kind) => {
    jev({
      'fact_keep:c1': KEEP,
      'fact_subject:c1': USER,
      'fact_kind:c1': answer(kind, { [kind]: 0.8 }),
    })
    const out = await decide([candidate()])
    expect(out.operations[0]).toMatchObject({ fact: { kind } })
  })

  it('fails loud on a kind outside the catalog', async () => {
    jev({
      'fact_keep:c1': KEEP,
      'fact_subject:c1': USER,
      'fact_kind:c1': answer('hobby', { hobby: 0.9 }),
    })
    await expect(decide([candidate()])).rejects.toThrow(/fact_kind "hobby"/)
  })
})

describe('fact_reconcile drives add / update / confirm / none against the nearest stored facts', () => {
  const nearest = [
    stored(),
    stored({
      id: POOL,
      kind: 'activity',
      statement: "The user's licence plate is [secure:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee]",
      asOf: new Date('2026-05-02T00:00:00Z'),
    }),
  ]
  const base = {
    'fact_keep:c1': KEEP,
    'fact_subject:c1': USER,
    'fact_kind:c1': answer('habit', { habit: 0.9, activity: 0.1 }),
  }

  it('asks one reconcile question per candidate that has nearest facts, with add / none / update_Fn / confirm_Fn', async () => {
    jev({ ...base, 'fact_reconcile:c1': answer('add', { add: 0.9, none: 0.1 }) })
    await decide([candidate({ statement: 'Quit drinking coffee in May 2026' })], [nearest])

    const spec = call().specs.find((s) => s.id === 'fact_reconcile:c1')!
    expect(spec.decisionKind).toBe('fact_reconcile')
    expect(spec.subjectRef).toBe('c1')
    expect(Object.keys(spec.question.criteria)).toEqual([
      'add',
      'none',
      'update_F1',
      'confirm_F1',
      'update_F2',
      'confirm_F2',
    ])
    expect(spec.question.instructions).toContain('Quit drinking coffee in May 2026')
    expect(spec.question.criteria.add).toMatch(/none of the stored facts states/i)
    expect(spec.question.criteria.none).toMatch(/already contained in a stored fact/i)
    expect(spec.question.criteria.update_F1).toContain('Drinks three coffees a day')
    expect(spec.question.criteria.update_F1).toContain('as of 2026-03-01')
    expect(spec.question.criteria.update_F1).toMatch(/no longer true and the candidate says what is true now/i)
    expect(spec.question.criteria.confirm_F1).toContain('Drinks three coffees a day')
    expect(spec.question.criteria.confirm_F1).toMatch(/same as stored fact F1 again, unchanged/i)
  })

  it('shows a stored identifier fact by its placeholder only and says who a stored fact is about', async () => {
    jev({ ...base, 'fact_reconcile:c1': answer('add', { add: 0.9, none: 0.1 }) })
    await decide(
      [candidate()],
      [[nearest[1]!, stored({ id: COFFEE, subjectKind: 'person', subjectLabel: 'Mia (friend)' })]],
    )
    const criteria = call().specs.find((s) => s.id === 'fact_reconcile:c1')!.question.criteria
    expect(criteria.update_F1).toContain(`The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`)
    expect(JSON.stringify(criteria)).not.toContain('eeeeeeee')
    expect(JSON.stringify(criteria)).not.toContain('[secure:')
    expect(criteria.update_F2).toContain('about Mia (friend)')
    expect(criteria.update_F1).toContain('about the user')
    // no id of a stored fact ever reaches Jev
    expect(JSON.stringify(call().specs)).not.toContain(COFFEE)
    expect(JSON.stringify(call().specs)).not.toContain(POOL)
  })

  it('add: stored as a new fact', async () => {
    jev({ ...base, 'fact_reconcile:c1': answer('add', { add: 0.9, none: 0.1 }) })
    const out = await decide([candidate()], [nearest])
    expect(out.operations).toEqual([expect.objectContaining({ op: 'add' })])
  })

  it('update: the new fact supersedes the stored one Jev named ("I quit coffee" after "three coffees a day")', async () => {
    jev({ ...base, 'fact_reconcile:c1': answer('update_F1', { update_F1: 0.85, add: 0.1, none: 0.05 }) })
    const out = await decide([candidate({ statement: 'Quit drinking coffee in May 2026' })], [nearest])
    expect(out.operations).toEqual([
      {
        op: 'update',
        supersedesFactId: COFFEE,
        fact: expect.objectContaining({
          statement: 'Quit drinking coffee in May 2026',
          kind: 'habit',
          confidence: 0.93,
        }),
      },
    ])
    expect(out.candidateIndexes).toEqual([0])
  })

  it('confirm: the stored fact is confirmed, the candidate adds nothing', async () => {
    jev({ ...base, 'fact_reconcile:c1': answer('confirm_F2', { confirm_F2: 0.8, add: 0.2 }) })
    const out = await decide([candidate()], [nearest])
    expect(out.operations).toEqual([{ op: 'confirm', factId: POOL }])
    expect(out.candidateIndexes).toEqual([])
  })

  it('none: nothing to write, counted as dropped by the judge', async () => {
    jev({ ...base, 'fact_reconcile:c1': answer('none', { none: 0.8, add: 0.2 }) })
    const out = await decide([candidate()], [nearest])
    expect(out.operations).toEqual([])
    expect(out.droppedByJudge).toBe(1)
  })

  it('no stored fact near the candidate: no reconcile question, a plain add', async () => {
    jev(base)
    const out = await decide([candidate()], [[]])
    expect(call().specs.map((s) => s.decisionKind)).not.toContain('fact_reconcile')
    expect(out.operations).toEqual([expect.objectContaining({ op: 'add' })])
  })

  it('a dropped candidate is not reconciled', async () => {
    jev({
      'fact_keep:c1': answer('drop', { drop: 0.9, keep: 0.1 }),
      'fact_subject:c1': USER,
      'fact_kind:c1': ACTIVITY,
      'fact_reconcile:c1': answer('update_F1', { update_F1: 0.9, add: 0.1 }),
    })
    const out = await decide([candidate()], [nearest])
    expect(out.operations).toEqual([])
  })

  it('candidates are reconciled against their own nearest facts', async () => {
    jev({
      ...base,
      'fact_keep:c2': KEEP,
      'fact_subject:c2': USER,
      'fact_kind:c2': ACTIVITY,
      'fact_reconcile:c1': answer('update_F1', { update_F1: 0.9, add: 0.1 }),
    })
    const out = await decide(
      [candidate({ statement: 'Quit coffee' }), candidate({ statement: 'Swims' })],
      [[nearest[0]!], []],
    )
    expect(call().specs.filter((s) => s.decisionKind === 'fact_reconcile')).toHaveLength(1)
    expect(out.operations.map((o) => o.op)).toEqual(['update', 'add'])
    expect(out.candidateIndexes).toEqual([0, 1])
  })

  it('two candidates may claim the same stored fact: both operations are kept (the store resolves it deterministically)', async () => {
    jev({
      ...base,
      'fact_keep:c2': KEEP,
      'fact_subject:c2': USER,
      'fact_kind:c2': ACTIVITY,
      'fact_reconcile:c1': answer('update_F1', { update_F1: 0.9, add: 0.1 }),
      'fact_reconcile:c2': answer('confirm_F1', { confirm_F1: 0.9, add: 0.1 }),
    })
    const out = await decide(
      [candidate({ statement: 'Quit coffee' }), candidate({ statement: 'Drinks tea now' })],
      [[nearest[0]!], [nearest[0]!]],
    )
    expect(out.operations.map((o) => o.op)).toEqual(['update', 'confirm'])
  })
})

describe('identifier candidates', () => {
  it('keep the identifier through the decision and show Jev only the placeholder statement', async () => {
    const identifier = { kind: 'licence_plate' as const, label: 'licence plate', value: 'B-XY 4711' }
    jev({ 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': answer('circumstance', { circumstance: 0.9 }) })
    const out = await decide(
      [candidate({ statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`, identifier })],
      undefined,
      { text: 'My licence plate is B-XY 4711' },
    )
    expect(out.operations[0]).toMatchObject({ fact: { identifier } })
    // the questions carry the placeholder statement, never the value; the state holds the capture
    // with the value replaced by the placeholder
    expect(JSON.stringify(call().specs)).not.toContain('B-XY 4711')
    expect(JSON.stringify(call().specs)).toContain(SECURE_VALUE_PLACEHOLDER)
    expect(call().state).not.toContain('B-XY 4711')
    expect(call().state).toContain(`My licence plate is ${SECURE_VALUE_PLACEHOLDER}`)
  })
})

describe('failure is loud', () => {
  it('propagates a Jev failure: no fallback to keeping everything or to a chat decision', async () => {
    runEnforcedBoundedDecisionsMock.mockRejectedValue(
      new Error('[decision-plane] enforced bounded decision(s) failed: gateway down'),
    )
    await expect(decide([candidate()])).rejects.toThrow('gateway down')
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('fails loud when a question was left unanswered', async () => {
    jev(
      { 'fact_keep:c1': KEEP, 'fact_subject:c1': USER, 'fact_kind:c1': ACTIVITY },
      { omit: ['fact_kind:c1'] },
    )
    await expect(decide([candidate()])).rejects.toThrow(/no answer for fact_kind:c1/)
  })

  it('fails loud on a reconcile choice that names no offered stored fact', async () => {
    jev({
      'fact_keep:c1': KEEP,
      'fact_subject:c1': USER,
      'fact_kind:c1': ACTIVITY,
      'fact_reconcile:c1': answer('update_F7', { update_F7: 0.9 }),
    })
    await expect(decide([candidate()], [[stored()]])).rejects.toThrow(/fact_reconcile "update_F7"/)
  })

  it('rejects a candidate list and a nearest list that do not line up', async () => {
    await expect(decide([candidate(), candidate()], [[]])).rejects.toThrow(/one nearest-facts list per candidate/)
    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
  })

  it('fails loud when keep is chosen without a keep probability', async () => {
    jev({
      'fact_keep:c1': answer('keep', { drop: 0.1 }),
      'fact_subject:c1': USER,
      'fact_kind:c1': ACTIVITY,
    })
    await expect(decide([candidate()])).rejects.toThrow(/fact_keep.*without a keep probability/)
  })
})
