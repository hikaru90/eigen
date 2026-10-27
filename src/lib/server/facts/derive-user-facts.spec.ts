import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock, runEnforcedBoundedDecisionsMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
  runEnforcedBoundedDecisionsMock: vi.fn(),
}))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))
// Every fact decision is Jev's; the plane is mocked at its boundary, no spec reaches the Decisions API.
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: runEnforcedBoundedDecisionsMock }
})
// the default (database) dependencies are never reached: every test injects its own
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))

import type { NearestFact } from './decide-user-facts'
import { FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import {
  FACT_REFERENCE_MAX_CHARS,
  deriveUserFactsForThought,
  type DeriveFactsDeps,
} from './derive-user-facts'
import { SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'

const THOUGHT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const COFFEE_FACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MIA_ENTITY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const AT = new Date('2026-06-02T08:30:00.000Z')

function chatReply(json: unknown) {
  return {
    choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }],
  }
}

type Candidate = {
  statement: string
  subject?: string | null
  entity?: string | null
  inferred?: boolean
  identifier?: unknown
}
const candidates = (...list: Candidate[]) =>
  chatReply({
    candidates: list.map((c) => ({
      subject: null,
      entity: null,
      inferred: false,
      identifier: null,
      ...c,
    })),
  })

type Answer = { choice: string; probabilities: Record<string, number> }
const answer = (choice: string, probabilities: Record<string, number>): Answer => ({
  choice,
  probabilities,
})
const KEEP = answer('keep', { keep: 0.93, drop: 0.07 })
const DROP = answer('drop', { drop: 0.95, keep: 0.05 })
const USER = answer('user', { user: 0.9, person: 0.1 })
const PERSON = answer('person', { person: 0.9, user: 0.1 })
const ACTIVITY = answer('activity', { activity: 0.8, habit: 0.2 })
const ADD = answer('add', { add: 0.9, none: 0.1 })

type PlaneCall = {
  state: string
  specs: Array<{ id: string; decisionKind: string; question: { instructions: string } }>
}

/** Jev's answers per candidate (c1, c2, …); unlisted questions get the plain "keep, user, activity, add". */
function jev(per: Record<string, { keep?: Answer; subject?: Answer; kind?: Answer; reconcile?: Answer }> = {}) {
  runEnforcedBoundedDecisionsMock.mockImplementation(async (input: PlaneCall) => {
    const out = new Map<string, unknown>()
    for (const spec of input.specs) {
      const [kind, ref] = spec.id.split(':') as [string, string]
      const own = per[ref] ?? {}
      const chosen =
        kind === 'fact_keep'
          ? (own.keep ?? KEEP)
          : kind === 'fact_subject'
            ? (own.subject ?? USER)
            : kind === 'fact_kind'
              ? (own.kind ?? ACTIVITY)
              : (own.reconcile ?? ADD)
      out.set(spec.id, {
        type: 'choice',
        choice: chosen.choice,
        probabilities: chosen.probabilities,
        confidence: chosen.probabilities[chosen.choice],
      })
    }
    return out
  })
}

const stored = (over: Partial<NearestFact> = {}): NearestFact => ({
  id: COFFEE_FACT,
  subjectKind: 'user',
  subjectLabel: null,
  kind: 'habit',
  statement: 'Drinks three coffees a day',
  inferred: false,
  asOf: new Date('2026-03-01T00:00:00Z'),
  ...over,
})

type Calls = {
  order: string[]
  embed: string[][]
  nearestQuery: Array<{ text: string; queryEmbedding: number[] }>
  persist: Array<Parameters<DeriveFactsDeps['persist']>[1]>
}

function harness(over: Partial<DeriveFactsDeps> = {}, nearestFacts: NearestFact[] = []) {
  const calls: Calls = { order: [], embed: [], nearestQuery: [], persist: [] }
  const deps: DeriveFactsDeps = {
    releaseThoughtFacts: async () => {
      calls.order.push('release')
    },
    loadReferenceText: async () => null,
    embed: async (_userId, texts) => {
      calls.order.push('embed')
      calls.embed.push(texts)
      return texts.map((_, i) => [i + 1])
    },
    loadKnownPeople: async () => [{ id: MIA_ENTITY, label: 'Mia', entityType: 'person' }],
    extractCandidates: async (input) => {
      calls.order.push('extract')
      const { extractFactCandidates } = await import('./extract-user-facts')
      return extractFactCandidates(input)
    },
    loadNearestFacts: async (_userId, input) => {
      calls.order.push('nearest')
      calls.nearestQuery.push(input)
      return nearestFacts
    },
    decide: async (input) => {
      calls.order.push('decide')
      const { decideFactCandidates } = await import('./decide-user-facts')
      return decideFactCandidates(input)
    },
    persist: async (_userId, input) => {
      calls.order.push('persist')
      calls.persist.push(input)
      return { added: input.plan.adds.length, superseded: 0, confirmed: input.plan.confirms.length }
    },
    ...over,
  }
  return { deps, calls }
}

const derive = (
  deps: DeriveFactsDeps,
  text: string,
  extra: Partial<Parameters<typeof deriveUserFactsForThought>[0]> = {},
) =>
  deriveUserFactsForThought(
    { userId: 'u1', thoughtId: THOUGHT, text, capturedAt: AT, ...extra },
    deps,
  )

const ZERO = { added: 0, superseded: 0, confirmed: 0, droppedByJudge: 0, droppedLowConfidence: 0 }

beforeEach(() => {
  llmChatCompletionMock.mockReset()
  runEnforcedBoundedDecisionsMock.mockReset()
  jev()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('deriveUserFactsForThought: acceptance cases of the plan (chat proposes, Jev decides)', () => {
  it('"I swam at the local pool again this morning" -> an active activity fact about the user with that thought as source', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Swims at the local pool' }))
    const { deps, calls } = harness()

    const out = await derive(deps, 'I swam at the local pool again this morning')

    expect(out).toMatchObject({ ...ZERO, added: 1 })
    expect(calls.persist).toHaveLength(1)
    const persisted = calls.persist[0]!
    expect(persisted.thoughtId).toBe(THOUGHT)
    expect(persisted.textFileId).toBeNull()
    expect(persisted.capturedAt).toEqual(AT)
    expect(persisted.plan.adds).toHaveLength(1)
    expect(persisted.plan.adds[0]).toMatchObject({
      subject: { kind: 'user' },
      kind: 'activity',
      displayStatement: 'Swims at the local pool',
      // Jev's probability is the stored confidence
      confidence: 0.93,
      inferred: false,
      supersedesFactId: null,
      secureValue: null,
    })
    // the statement (not the capture) is what gets embedded — once, reused for the write
    expect(calls.embed).toEqual([['Swims at the local pool']])
    expect(persisted.embeddings).toEqual([[1]])
  })

  it('"My friend Mia keeps getting headaches, she barely drinks water" -> facts about "Mia (friend)", none about the user', async () => {
    llmChatCompletionMock.mockResolvedValue(
      candidates(
        { statement: 'Mia (friend) keeps getting headaches', subject: 'Mia (friend)', entity: 'E1' },
        { statement: 'Mia (friend) barely drinks water', subject: 'Mia (friend)', entity: 'E1' },
      ),
    )
    jev({
      c1: { subject: PERSON, kind: answer('health', { health: 0.9, habit: 0.1 }) },
      c2: { subject: PERSON, kind: answer('habit', { habit: 0.8, health: 0.2 }) },
    })
    const { deps, calls } = harness()
    await derive(deps, 'My friend Mia keeps getting headaches, she barely drinks water')
    const adds = calls.persist[0]!.plan.adds
    expect(adds).toHaveLength(2)
    for (const add of adds) {
      expect(add.subject).toEqual({ kind: 'person', label: 'Mia (friend)', entityId: MIA_ENTITY })
    }
    expect(adds.map((a) => a.kind)).toEqual(['health', 'habit'])
    expect(adds.some((a) => a.subject.kind === 'user')).toBe(false)
  })

  it('a pasted recipe with no personal text -> no candidate: nothing embedded, nothing asked of Jev, nothing written', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates())
    const { deps, calls } = harness()
    const out = await derive(deps, 'Pasta al limone: 200 g spaghetti, 2 lemons, 50 g parmesan')
    expect(out).toEqual(ZERO)
    expect(calls.persist).toEqual([])
    expect(calls.embed).toEqual([])
    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
  })

  it('"I quit coffee last month" after "I drink three coffees a day" -> Jev reconciles: the new fact supersedes the stored one', async () => {
    llmChatCompletionMock.mockResolvedValue(
      candidates({ statement: 'Quit drinking coffee in May 2026' }),
    )
    jev({ c1: { kind: answer('habit', { habit: 0.9, activity: 0.1 }), reconcile: answer('update_F1', { update_F1: 0.88, add: 0.12 }) } })
    const { deps, calls } = harness({}, [stored()])

    await derive(deps, 'I quit coffee last month')

    // the stored facts nearest to the CANDIDATE are looked up with the candidate's own embedding
    expect(calls.nearestQuery).toEqual([{ text: 'Quit drinking coffee in May 2026', queryEmbedding: [1] }])
    // the chat model is never shown a stored fact: reconciliation is not its business
    expect(JSON.stringify(llmChatCompletionMock.mock.calls)).not.toContain('Drinks three coffees a day')
    // Jev is
    const reconcile = (runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as PlaneCall).specs.find(
      (s) => s.decisionKind === 'fact_reconcile',
    )
    expect(reconcile).toBeDefined()
    expect(calls.persist[0]!.plan.adds[0]).toMatchObject({
      supersedesFactId: COFFEE_FACT,
      displayStatement: 'Quit drinking coffee in May 2026',
    })
  })

  it('a capture that restates a stored fact -> a confirm, no second fact, nothing written for the candidate', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Drinks a third coffee today' }))
    jev({ c1: { reconcile: answer('confirm_F1', { confirm_F1: 0.8, add: 0.2 }) } })
    const { deps, calls } = harness({}, [stored({ asOf: AT })])
    await derive(deps, 'Third coffee already today')
    expect(calls.persist[0]!.plan).toEqual({ adds: [], confirms: [COFFEE_FACT] })
    expect(calls.persist[0]!.embeddings).toEqual([])
  })

  it('"please forget that I drink coffee" -> Jev drops the request: nothing is stored', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Drinks coffee' }))
    jev({ c1: { keep: DROP } })
    const { deps, calls } = harness()
    const out = await derive(deps, 'please forget that I drink coffee')
    expect(calls.persist).toEqual([])
    expect(out).toEqual({ ...ZERO, droppedByJudge: 1 })
  })

  it('a fragment and a piece of trivia are dropped by Jev, a real fact next to them is stored', async () => {
    llmChatCompletionMock.mockResolvedValue(
      candidates(
        { statement: 'The user.' },
        { statement: 'The oolong has a faint scent of orchids' },
        { statement: 'Swims at the local pool' },
      ),
    )
    jev({ c1: { keep: DROP }, c2: { keep: DROP } })
    const { deps, calls } = harness()

    const out = await derive(deps, 'I swam; the oolong smelled of orchids')

    expect(out).toMatchObject({ added: 1, droppedByJudge: 2 })
    expect(calls.persist[0]!.plan.adds.map((a) => a.displayStatement)).toEqual([
      'Swims at the local pool',
    ])
    // only the stored candidate's embedding is written; the dropped ones were embedded for the lookup only
    expect(calls.embed).toEqual([
      ['The user.', 'The oolong has a faint scent of orchids', 'Swims at the local pool'],
    ])
    expect(calls.persist[0]!.embeddings).toEqual([[3]])
  })

  it('a candidate Jev keeps below the 0.7 gate is not stored and only counted', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Probably surfs', inferred: true }))
    jev({ c1: { keep: answer('keep', { keep: 0.55, drop: 0.45 }) } })
    const { deps, calls } = harness()
    const out = await derive(deps, 'an early morning out on the waves')
    expect(out).toEqual({ ...ZERO, droppedLowConfidence: 1 })
    expect(calls.persist).toEqual([])
  })

  it('malformed JSON fails loud: nothing is embedded, asked of Jev or written, and the error names the step', async () => {
    llmChatCompletionMock.mockResolvedValue(chatReply('Sorry, I cannot help with that.'))
    const { deps, calls } = harness()
    await expect(derive(deps, 'I swam at the local pool')).rejects.toThrow(/user fact extraction/)
    expect(calls.persist).toEqual([])
    expect(calls.embed).toEqual([])
    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
  })

  it('a failing Jev call fails the derivation (the ingest retry ladder owns recovery): nothing is written, no chat fallback', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Swims at the local pool' }))
    runEnforcedBoundedDecisionsMock.mockRejectedValue(new Error('jev down'))
    const { deps, calls } = harness()
    await expect(derive(deps, 'I swam')).rejects.toThrow('jev down')
    expect(calls.persist).toEqual([])
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('no chat call decides any of it: the only chat call is the candidate proposal', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Swims at the local pool' }))
    const { deps } = harness({}, [stored()])
    await derive(deps, 'I swam')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(llmChatCompletionMock.mock.calls[0]![0].logContext).toBe('user_fact_extraction')
    // ONE Decisions call carries every question of the capture
    expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    const kinds = new Set(
      (runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as PlaneCall).specs.map((s) => s.decisionKind),
    )
    expect([...kinds].sort()).toEqual(['fact_keep', 'fact_kind', 'fact_reconcile', 'fact_subject'])
  })
})

describe('deriveUserFactsForThought: identifiers (Q3)', () => {
  const PLATE = 'B-XY 4711'
  const plate = {
    statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
    identifier: { kind: 'licence_plate', label: 'licence plate', value: PLATE },
  }

  it('moves the value into a secure value; the fact, its embedding input, its keyword surface, the Jev payload and every log line are value-free', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates(plate))
    jev({ c1: { kind: answer('circumstance', { circumstance: 0.9, habit: 0.1 }) } })
    const { deps, calls } = harness()

    await derive(deps, `My licence plate is ${PLATE}`)

    const persisted = calls.persist[0]!
    const add = persisted.plan.adds[0]!
    expect(add.secureValue).toMatchObject({ kind: 'licence_plate', value: PLATE })
    const { secureValue, ...valueFree } = add
    expect(secureValue).not.toBeNull()
    expect(JSON.stringify(valueFree)).not.toContain(PLATE)
    expect(JSON.stringify(calls.embed)).not.toContain(PLATE)
    expect(JSON.stringify(calls.nearestQuery)).not.toContain(PLATE)
    // Jev sees the capture with the identifier value replaced by the placeholder, and the placeholder statement
    expect(JSON.stringify(runEnforcedBoundedDecisionsMock.mock.calls)).not.toContain(PLATE)
    expect((runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as PlaneCall).state).toContain(
      `My licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
    )
    // the log lines carry counts, never text
    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ])
    expect(logged).not.toContain(PLATE)
    expect(logged).not.toContain('licence plate')
  })

  it('a later candidate sees a stored identifier fact by its placeholder only', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Parks the car at home' }))
    const { deps } = harness({}, [
      stored({
        kind: 'circumstance',
        statement: "The user's licence plate is [secure:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee]",
      }),
    ])
    await derive(deps, 'Parked the car again')
    const payload = JSON.stringify(runEnforcedBoundedDecisionsMock.mock.calls)
    expect(payload).toContain(`The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`)
    expect(payload).not.toContain('eeeeeeee')
    expect(payload).not.toContain(PLATE)
  })
})

describe('deriveUserFactsForThought: provenance and flow', () => {
  it('releases what this thought derived before, then proposes, embeds, looks up the nearest stored facts, decides, writes: re-derive on every run', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Swims at the local pool' }))
    const { deps, calls } = harness()
    await derive(deps, 'I swam at the local pool')
    expect(calls.order).toEqual(['release', 'extract', 'embed', 'nearest', 'decide', 'persist'])
  })

  it('gives the proposer and Jev the reference note (secret-redacted) and records the note as a source', async () => {
    llmChatCompletionMock.mockResolvedValue(
      candidates({ statement: 'Surfs before conferences', inferred: true }),
    )
    const body = `Dear Prof. Lee, an early morning out on the waves before the keynote. key=${FAKE_SECRETS.openai}`
    const { deps, calls } = harness({ loadReferenceText: async () => body })

    await derive(deps, 'Email to Prof. Lee about the keynote', { attachedFileId: FILE })

    const payload = JSON.stringify([
      llmChatCompletionMock.mock.calls[0]![0].messages,
      runEnforcedBoundedDecisionsMock.mock.calls,
    ])
    expect(payload).toContain('an early morning out on the waves before the keynote')
    expect(leaks(payload)).toBe(false)
    expect(calls.persist[0]!.textFileId).toBe(FILE)
  })

  it('does not record a note that is gone as a source and still proposes from the thought', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Swims at the local pool' }))
    const { deps, calls } = harness({ loadReferenceText: async () => null })
    await derive(deps, 'I swam today', { attachedFileId: FILE })
    expect(calls.persist[0]!.textFileId).toBeNull()
  })

  it(`bounds the reference text at ${FACT_REFERENCE_MAX_CHARS} characters and says so`, async () => {
    llmChatCompletionMock.mockResolvedValue(candidates())
    const { deps } = harness({
      loadReferenceText: async () => 'Ω'.repeat(FACT_REFERENCE_MAX_CHARS + 500),
    })
    await derive(deps, 'Long document', { attachedFileId: FILE })
    const user = llmChatCompletionMock.mock.calls[0]![0].messages[1].content as string
    expect(user.match(/Ω/g)!.length).toBe(FACT_REFERENCE_MAX_CHARS)
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toMatch(/truncated/)
  })

  it('an empty capture releases its old facts and asks no model', async () => {
    const { deps, calls } = harness()
    const out = await derive(deps, '   ')
    expect(out).toEqual(ZERO)
    expect(calls.order).toEqual(['release'])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
  })

  it('a credential in the capture never reaches the proposer or Jev (defence in depth over the upstream redaction)', async () => {
    llmChatCompletionMock.mockResolvedValue(candidates({ statement: 'Swims daily' }))
    const { deps } = harness()
    await derive(deps, `my key is ${FAKE_SECRETS.openai} and I swim daily`)
    expect(
      leaks(
        JSON.stringify([
          llmChatCompletionMock.mock.calls[0]![0].messages,
          runEnforcedBoundedDecisionsMock.mock.calls,
        ]),
      ),
    ).toBe(false)
  })
})
