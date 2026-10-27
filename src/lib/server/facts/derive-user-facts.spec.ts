import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))
// the default (database) dependencies are never reached: every test injects its own
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))

import { FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import {
  FACT_REFERENCE_MAX_CHARS,
  deriveUserFactsForThought,
  type DeriveFactsDeps,
} from './derive-user-facts'
import { extractUserFacts, type StoredFactForPrompt } from './extract-user-facts'
import { SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'

const THOUGHT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const COFFEE_FACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MIA_ENTITY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const AT = new Date('2026-06-02T08:30:00.000Z')
const CAPTURE_VECTOR = [0.5]

function reply(json: unknown) {
  return {
    choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }],
  }
}

type Calls = {
  order: string[]
  embed: string[][]
  storedQuery: Array<{ text: string; queryEmbedding: number[] }>
  persist: Array<Parameters<DeriveFactsDeps['persist']>[1]>
}

function harness(over: Partial<DeriveFactsDeps> = {}, stored: StoredFactForPrompt[] = []) {
  const calls: Calls = { order: [], embed: [], storedQuery: [], persist: [] }
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
    loadStoredFacts: async (_userId, input) => {
      calls.order.push('load_stored')
      calls.storedQuery.push(input)
      return stored
    },
    loadKnownPeople: async () => [{ id: MIA_ENTITY, label: 'Mia', entityType: 'person' }],
    extract: async (input) => {
      calls.order.push('extract')
      return extractUserFacts(input)
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
    {
      userId: 'u1',
      thoughtId: THOUGHT,
      text,
      capturedAt: AT,
      queryEmbedding: CAPTURE_VECTOR,
      ...extra,
    },
    deps,
  )

beforeEach(() => {
  llmChatCompletionMock.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('deriveUserFactsForThought: acceptance cases of the plan', () => {
  it('"I swam at the local pool again this morning" -> an active activity fact about the user with that thought as source', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'add',
            subject: { kind: 'user' },
            kind: 'activity',
            statement: 'Swims at the local pool',
            confidence: 0.93,
            inferred: false,
          },
        ],
      }),
    )
    const { deps, calls } = harness()

    const out = await derive(deps, 'I swam at the local pool again this morning')

    expect(out).toMatchObject({ added: 1, superseded: 0, confirmed: 0, droppedLowConfidence: 0 })
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
      inferred: false,
      supersedesFactId: null,
      secureValue: null,
    })
    // the statement (not the capture) is what gets embedded
    expect(calls.embed).toEqual([['Swims at the local pool']])
    expect(persisted.embeddings).toEqual([[1]])
  })

  it('"My friend Mia keeps getting headaches, she barely drinks water" -> facts about "Mia (friend)", none about the user', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'add',
            subject: { kind: 'person', label: 'Mia (friend)', entity: 'E1' },
            kind: 'health',
            statement: 'Mia (friend) keeps getting headaches',
            confidence: 0.9,
            inferred: false,
          },
          {
            op: 'add',
            subject: { kind: 'person', label: 'Mia (friend)', entity: 'E1' },
            kind: 'habit',
            statement: 'Mia (friend) barely drinks water',
            confidence: 0.9,
            inferred: false,
          },
        ],
      }),
    )
    const { deps, calls } = harness()
    await derive(deps, 'My friend Mia keeps getting headaches, she barely drinks water')
    const adds = calls.persist[0]!.plan.adds
    expect(adds).toHaveLength(2)
    for (const add of adds) {
      expect(add.subject).toEqual({ kind: 'person', label: 'Mia (friend)', entityId: MIA_ENTITY })
    }
    expect(adds.some((a) => a.subject.kind === 'user')).toBe(false)
  })

  it('a pasted recipe with no personal text -> no fact, nothing embedded, nothing written', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [] }))
    const { deps, calls } = harness()
    const out = await derive(deps, 'Pasta al limone: 200 g spaghetti, 2 lemons, 50 g parmesan')
    expect(out).toEqual({ added: 0, superseded: 0, confirmed: 0, droppedLowConfidence: 0 })
    expect(calls.persist).toEqual([])
    expect(calls.embed).toEqual([])
  })

  it('"I quit coffee last month" after "I drink three coffees a day" -> the new fact supersedes the stored one', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'update',
            supersedes: 'F1',
            subject: { kind: 'user' },
            kind: 'habit',
            statement: 'Quit drinking coffee in May 2026',
            confidence: 0.9,
            inferred: false,
          },
        ],
      }),
    )
    const { deps, calls } = harness({}, [
      {
        id: COFFEE_FACT,
        subjectKind: 'user',
        subjectLabel: null,
        kind: 'habit',
        statement: 'Drinks three coffees a day',
        inferred: false,
        asOf: new Date('2026-03-01T00:00:00Z'),
      },
    ])

    await derive(deps, 'I quit coffee last month')

    // the extractor was shown the stored fact (found by meaning, with the capture's embedding)
    expect(calls.storedQuery).toEqual([
      { text: 'I quit coffee last month', queryEmbedding: CAPTURE_VECTOR },
    ])
    const prompt = llmChatCompletionMock.mock.calls[0]![0].messages[1].content as string
    expect(prompt).toContain('Drinks three coffees a day')
    expect(calls.persist[0]!.plan.adds[0]).toMatchObject({
      supersedesFactId: COFFEE_FACT,
      displayStatement: 'Quit drinking coffee in May 2026',
    })
  })

  it('a capture that restates a stored fact -> a confirm, no second fact', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [{ op: 'confirm', confirms: 'F1' }] }))
    const { deps, calls } = harness({}, [
      {
        id: COFFEE_FACT,
        subjectKind: 'user',
        subjectLabel: null,
        kind: 'habit',
        statement: 'Drinks three coffees a day',
        inferred: false,
        asOf: AT,
      },
    ])
    await derive(deps, 'Third coffee already today')
    expect(calls.persist[0]!.plan).toEqual({ adds: [], confirms: [COFFEE_FACT] })
    expect(calls.embed).toEqual([])
  })

  it('"please forget that I drink coffee" -> the model returns none: nothing is stored', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [{ op: 'none' }] }))
    const { deps, calls } = harness()
    await derive(deps, 'please forget that I drink coffee')
    expect(calls.persist).toEqual([])
  })

  it('facts below the confidence gate are not stored and only counted', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'add',
            subject: { kind: 'user' },
            kind: 'activity',
            statement: 'Probably surfs',
            confidence: 0.5,
            inferred: true,
          },
        ],
      }),
    )
    const { deps, calls } = harness()
    const out = await derive(deps, 'an early morning out on the waves')
    expect(out.droppedLowConfidence).toBe(1)
    expect(calls.persist).toEqual([])
  })

  it('malformed JSON fails loud: nothing is written and the error names the step', async () => {
    llmChatCompletionMock.mockResolvedValue(reply('Sorry, I cannot help with that.'))
    const { deps, calls } = harness()
    await expect(derive(deps, 'I swam at the local pool')).rejects.toThrow(/user fact extraction/)
    expect(calls.persist).toEqual([])
  })
})

describe('deriveUserFactsForThought: identifiers (Q3)', () => {
  const PLATE = 'B-XY 4711'
  const plateReply = reply({
    facts: [
      {
        op: 'add',
        subject: { kind: 'user' },
        kind: 'circumstance',
        statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
        confidence: 0.95,
        inferred: false,
        identifier: { kind: 'licence_plate', label: 'licence plate', value: PLATE },
      },
    ],
  })

  it('moves the value into a secure value; the fact, its embedding input, its keyword surface and every log line are value-free', async () => {
    llmChatCompletionMock.mockResolvedValue(plateReply)
    const { deps, calls } = harness()

    await derive(deps, `My licence plate is ${PLATE}`)

    const persisted = calls.persist[0]!
    const add = persisted.plan.adds[0]!
    expect(add.secureValue).toMatchObject({ kind: 'licence_plate', value: PLATE })
    const { secureValue, ...valueFree } = add
    expect(secureValue).not.toBeNull()
    expect(JSON.stringify(valueFree)).not.toContain(PLATE)
    expect(JSON.stringify(calls.embed)).not.toContain(PLATE)
    expect(JSON.stringify(calls.storedQuery.map((q) => ({ ...q, text: '' })))).not.toContain(PLATE)
    // the log lines carry counts, never text
    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ])
    expect(logged).not.toContain(PLATE)
    expect(logged).not.toContain('licence plate')
  })

  it('a later capture sees the stored identifier fact by its placeholder only', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [{ op: 'confirm', confirms: 'F1' }] }))
    const { deps } = harness({}, [
      {
        id: COFFEE_FACT,
        subjectKind: 'user',
        subjectLabel: null,
        kind: 'circumstance',
        statement: "The user's licence plate is [secure:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee]",
        inferred: false,
        asOf: AT,
      },
    ])
    await derive(deps, 'Parked the car again')
    const prompt = llmChatCompletionMock.mock.calls[0]![0].messages[1].content as string
    expect(prompt).toContain(`The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`)
    expect(prompt).not.toContain('eeeeeeee')
    expect(prompt).not.toContain(PLATE)
  })
})

describe('deriveUserFactsForThought: provenance and flow', () => {
  it('releases what this thought derived before, then reconciles against the rest: re-derive on every run', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [] }))
    const { deps, calls } = harness()
    await derive(deps, 'I swam at the local pool')
    expect(calls.order.slice(0, 3)).toEqual(['release', 'load_stored', 'extract'])
  })

  it('gives the extractor the reference note (secret-redacted) and records the note as a source', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'add',
            subject: { kind: 'user' },
            kind: 'activity',
            statement: 'Surfs before conferences',
            confidence: 0.8,
            inferred: true,
          },
        ],
      }),
    )
    const body = `Dear Prof. Lee, an early morning out on the waves before the keynote. key=${FAKE_SECRETS.openai}`
    const { deps, calls } = harness({ loadReferenceText: async () => body })

    await derive(deps, 'Email to Prof. Lee about the keynote', { attachedFileId: FILE })

    const payload = JSON.stringify(llmChatCompletionMock.mock.calls[0]![0].messages)
    expect(payload).toContain('an early morning out on the waves before the keynote')
    expect(leaks(payload)).toBe(false)
    expect(calls.persist[0]!.textFileId).toBe(FILE)
  })

  it('does not record a note that is gone as a source and still extracts from the thought', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'add',
            subject: { kind: 'user' },
            kind: 'activity',
            statement: 'Swims at the local pool',
            confidence: 0.9,
            inferred: false,
          },
        ],
      }),
    )
    const { deps, calls } = harness({ loadReferenceText: async () => null })
    await derive(deps, 'I swam today', { attachedFileId: FILE })
    expect(calls.persist[0]!.textFileId).toBeNull()
  })

  it(`bounds the reference text at ${FACT_REFERENCE_MAX_CHARS} characters and says so`, async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [] }))
    const { deps } = harness({
      loadReferenceText: async () => 'Ω'.repeat(FACT_REFERENCE_MAX_CHARS + 500),
    })
    await derive(deps, 'Long document', { attachedFileId: FILE })
    const user = llmChatCompletionMock.mock.calls[0]![0].messages[1].content as string
    expect(user.match(/Ω/g)!.length).toBe(FACT_REFERENCE_MAX_CHARS)
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toMatch(/truncated/)
  })

  it('without a ready embedding it embeds the capture itself to find related stored facts', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [] }))
    const { deps, calls } = harness()
    await deriveUserFactsForThought(
      { userId: 'u1', thoughtId: THOUGHT, text: 'I swam today', capturedAt: AT },
      deps,
    )
    expect(calls.embed[0]).toEqual(['I swam today'])
    expect(calls.storedQuery[0]!.queryEmbedding).toEqual([1])
  })

  it('an empty capture releases its old facts and asks no model', async () => {
    const { deps, calls } = harness()
    const out = await derive(deps, '   ')
    expect(out).toEqual({ added: 0, superseded: 0, confirmed: 0, droppedLowConfidence: 0 })
    expect(calls.order).toEqual(['release'])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('a credential in the capture never reaches the model (defence in depth over the upstream redaction)', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [] }))
    const { deps } = harness()
    await derive(deps, `my key is ${FAKE_SECRETS.openai} and I swim daily`)
    expect(leaks(JSON.stringify(llmChatCompletionMock.mock.calls[0]![0].messages))).toBe(false)
  })
})
