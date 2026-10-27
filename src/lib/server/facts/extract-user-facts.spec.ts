import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import {
  rememberEvalLlmCacheOrigin,
  type EvalLlmCache,
  type EvalLlmCacheRequest,
} from '$lib/server/llm/eval-llm-cache'
import {
  USER_FACT_EXTRACTION_PROMPT,
  buildFactExtractionMessages,
  extractUserFacts,
  type KnownPerson,
  type StoredFactForPrompt,
} from './extract-user-facts'
import { SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'

const F_POOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const F_PLATE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECURE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const E_MIA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CAPTURED_AT = new Date('2026-06-02T08:30:00.000Z')

const stored: StoredFactForPrompt[] = [
  {
    id: F_POOL,
    subjectKind: 'user',
    subjectLabel: null,
    kind: 'activity',
    statement: 'Swims at the local pool',
    inferred: false,
    asOf: new Date('2026-05-01T00:00:00Z'),
  },
  {
    id: F_PLATE,
    subjectKind: 'user',
    subjectLabel: null,
    kind: 'circumstance',
    statement: `The user's licence plate is [secure:${SECURE_ID}]`,
    inferred: false,
    asOf: new Date('2026-05-02T00:00:00Z'),
  },
]
const people: KnownPerson[] = [{ id: E_MIA, label: 'Mia', entityType: 'person' }]

function reply(json: unknown) {
  return {
    choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }],
  }
}

const base = {
  userId: 'u1',
  text: 'My friend Mia keeps getting headaches, she barely drinks water',
  capturedAt: CAPTURED_AT,
  storedFacts: stored,
  people,
}

beforeEach(() => llmChatCompletionMock.mockReset())

describe('USER_FACT_EXTRACTION_PROMPT', () => {
  it('states the operator decisions: personally relevant facts about people, inferred allowed with a 0.7 gate', () => {
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/personally relevant/i)
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/never a fact/i)
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/recipe/i)
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/"inferred": true/)
    expect(USER_FACT_EXTRACTION_PROMPT).toContain('0.7')
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/any language/i)
  })

  it('attributes facts to the right person and never to the user for what is said about a friend', () => {
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/fact about that friend/i)
    expect(USER_FACT_EXTRACTION_PROMPT).toContain('"kind":"person"')
  })

  it('teaches the four ops and that a stored fact is confirmed, never added twice', () => {
    for (const op of ['"add"', '"update"', '"confirm"', '"none"', 'supersedes', 'confirms']) {
      expect(USER_FACT_EXTRACTION_PROMPT).toContain(op)
    }
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/Never "add" a fact that is already stored/)
  })

  it('keeps identifier values out of the statement via the placeholder and treats a forget request as no fact', () => {
    expect(USER_FACT_EXTRACTION_PROMPT).toContain(SECURE_VALUE_PLACEHOLDER)
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/value must never appear in "statement"/)
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(
      /forget or remove something from memory is an instruction/,
    )
    expect(USER_FACT_EXTRACTION_PROMPT).toMatch(/Credentials/)
  })
})

describe('buildFactExtractionMessages', () => {
  it('sends the capture, the capture date, known people and stored facts by ref — never an id', () => {
    const { messages } = buildFactExtractionMessages({ ...base, referenceText: null })
    expect(messages[0]).toEqual({ role: 'system', content: USER_FACT_EXTRACTION_PROMPT })
    const user = messages[1]!.content
    expect(user).toContain(base.text)
    expect(user).toContain('2026-06-02')
    expect(user).toContain('[E1] Mia')
    expect(user).toContain('[F1]')
    expect(user).toContain('Swims at the local pool')
    for (const id of [F_POOL, F_PLATE, E_MIA, SECURE_ID]) expect(user).not.toContain(id)
  })

  it('shows an identifier fact by its placeholder, so no reference id reaches the model', () => {
    const user = buildFactExtractionMessages({ ...base, referenceText: null }).messages[1]!.content
    expect(user).toContain(`The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`)
    expect(user).not.toContain('[secure:')
  })

  it('shows the subject of a stored fact about another person, inferred marked', () => {
    const user = buildFactExtractionMessages({
      ...base,
      storedFacts: [
        {
          id: F_POOL,
          subjectKind: 'person',
          subjectLabel: 'Mia (friend)',
          kind: 'health',
          statement: 'Mia keeps getting headaches',
          inferred: true,
          asOf: new Date('2026-05-01T00:00:00Z'),
        },
      ],
      referenceText: null,
    }).messages[1]!.content
    expect(user).toMatch(
      /\[F1\] Mia \(friend\) · health · as of 2026-05-01 · inferred · Mia keeps getting headaches/,
    )
  })

  it('includes the reference text only when there is one, labelled as reference', () => {
    const without = buildFactExtractionMessages({ ...base, referenceText: null }).messages[1]!
      .content
    expect(without).not.toMatch(/reference text/i)
    const withRef = buildFactExtractionMessages({
      ...base,
      referenceText: 'Dear Prof. Lee, an early morning out on the waves before the keynote',
    }).messages[1]!.content
    expect(withRef).toContain('an early morning out on the waves before the keynote')
    expect(withRef).toMatch(/reference text/i)
  })

  it('says "none" instead of an empty list for no people and no stored facts', () => {
    const user = buildFactExtractionMessages({
      ...base,
      storedFacts: [],
      people: [],
      referenceText: null,
    }).messages[1]!.content
    expect(user.match(/none/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the capture out of the first 300 characters of the user message (the activity log keeps those)', () => {
    const user = buildFactExtractionMessages({
      ...base,
      storedFacts: [],
      people: [],
      referenceText: null,
    }).messages[1]!.content
    expect(user.slice(0, 300)).not.toContain(base.text)
    expect(user.indexOf(base.text)).toBeGreaterThan(300)
  })
})

describe('extractUserFacts', () => {
  it('asks once in json mode and maps refs back to ids', async () => {
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
          { op: 'confirm', confirms: 'F1' },
          {
            op: 'update',
            supersedes: 'F2',
            subject: { kind: 'user' },
            kind: 'circumstance',
            statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
            confidence: 0.95,
            inferred: false,
            identifier: { kind: 'licence_plate', label: 'licence plate', value: 'M-AB 1' },
          },
        ],
      }),
    )

    const out = await extractUserFacts(base)

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const call = llmChatCompletionMock.mock.calls[0]![0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.logContext).toBe('user_fact_extraction')
    expect(call.userId).toBe('u1')
    expect(out.operations).toEqual([
      expect.objectContaining({
        op: 'add',
        fact: expect.objectContaining({
          subject: { kind: 'person', label: 'Mia (friend)', entityId: E_MIA },
        }),
      }),
      { op: 'confirm', factId: F_POOL },
      expect.objectContaining({ op: 'update', supersedesFactId: F_PLATE }),
    ])
  })

  it('no stored facts and nothing found: still one call, empty result', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ facts: [] }))
    const out = await extractUserFacts({
      ...base,
      storedFacts: [],
      people: [],
      text: 'Recipe: 200 g flour',
    })
    expect(out).toEqual({ operations: [], droppedLowConfidence: 0 })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('throws on an empty or malformed reply and evicts the rejected reply from the eval cache', async () => {
    const evict = vi.fn(() => true)
    const cache = { evict } as unknown as EvalLlmCache
    const request: EvalLlmCacheRequest = { endpoint: 'chat', provider: 'p', model: 'm', body: {} }

    for (const content of ['', 'Sorry, I cannot do that', '{"facts":"x"}']) {
      evict.mockClear()
      const response = reply(content)
      rememberEvalLlmCacheOrigin(response, cache, request)
      llmChatCompletionMock.mockResolvedValue(response)
      await expect(extractUserFacts(base)).rejects.toThrow(/user fact extraction/)
      expect(evict).toHaveBeenCalledWith(request)
    }
  })

  it('does not evict a reply it accepted', async () => {
    const evict = vi.fn(() => true)
    const response = reply({ facts: [] })
    rememberEvalLlmCacheOrigin(response, { evict } as unknown as EvalLlmCache, {
      endpoint: 'chat',
      provider: 'p',
      model: 'm',
      body: {},
    })
    llmChatCompletionMock.mockResolvedValue(response)
    await extractUserFacts(base)
    expect(evict).not.toHaveBeenCalled()
  })

  it('an error about a bad reply never repeats the capture or an identifier value', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        facts: [
          {
            op: 'add',
            subject: { kind: 'user' },
            kind: 'circumstance',
            statement: 'The user parks the car at B-XY 4711',
            confidence: 0.9,
            inferred: false,
            identifier: { kind: 'licence_plate', label: 'plate', value: 'B-XY 4711' },
          },
        ],
      }),
    )
    const err = await extractUserFacts({ ...base, text: 'my plate is B-XY 4711' }).catch(
      (e) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).not.toContain('B-XY 4711')
    expect(String((err as Error).message)).not.toContain('my plate')
  })
})

describe('extractUserFacts: unknown refs are re-asked once', () => {
  const unknownEntity = () =>
    reply({
      facts: [
        {
          op: 'add',
          subject: { kind: 'person', label: 'Mia (friend)', entity: 'E9' },
          kind: 'health',
          statement: 'Mia (friend) keeps getting headaches',
          confidence: 0.9,
          inferred: false,
        },
      ],
    })
  const unknownStoredFact = () => reply({ facts: [{ op: 'confirm', confirms: 'F9' }] })
  const good = () =>
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
      ],
    })

  it('an entity ref that was never offered: one corrective re-ask, the bad reply evicted, the corrected reply used', async () => {
    const evict = vi.fn(() => true)
    const bad = unknownEntity()
    rememberEvalLlmCacheOrigin(bad, { evict } as unknown as EvalLlmCache, {
      endpoint: 'chat',
      provider: 'p',
      model: 'm',
      body: {},
    })
    llmChatCompletionMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(good())

    const out = await extractUserFacts(base)

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(evict).toHaveBeenCalledTimes(1)
    expect(out.operations).toEqual([
      expect.objectContaining({
        op: 'add',
        fact: expect.objectContaining({
          subject: { kind: 'person', label: 'Mia (friend)', entityId: E_MIA },
        }),
      }),
    ])
  })

  it('the re-ask keeps the original messages, then the bad reply and a short corrective message that never repeats the bad ref', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(unknownEntity()).mockResolvedValueOnce(good())

    await extractUserFacts(base)

    const first = llmChatCompletionMock.mock.calls[0]![0].messages
    const second = llmChatCompletionMock.mock.calls[1]![0].messages
    expect(second.slice(0, first.length)).toEqual(first)
    expect(second).toHaveLength(first.length + 2)
    expect(second[first.length]).toEqual({
      role: 'assistant',
      content: JSON.stringify(JSON.parse(unknownEntity().choices[0]!.message.content)),
    })
    const corrective = second[first.length + 1]!
    expect(corrective.role).toBe('user')
    expect(corrective.content).toMatch(/entity/)
    expect(corrective.content).toMatch(/E1/)
    expect(corrective.content).not.toContain('E9')
    expect(corrective.content.length).toBeLessThan(400)
    const call = llmChatCompletionMock.mock.calls[1]![0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.logContext).toBe('user_fact_extraction')
  })

  it('a stored-fact ref that was never offered is re-asked the same way', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce(unknownStoredFact())
      .mockResolvedValueOnce(reply({ facts: [{ op: 'confirm', confirms: 'F1' }] }))
    const out = await extractUserFacts(base)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    const corrective = llmChatCompletionMock.mock.calls[1]![0].messages.at(-1)
    expect(corrective.content).toMatch(/stored fact/)
    expect(corrective.content).not.toContain('F9')
    expect(out.operations).toEqual([{ op: 'confirm', factId: F_POOL }])
  })

  it('when nothing of that kind was offered, the correction says so instead of listing refs', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(unknownEntity()).mockResolvedValueOnce(good())
    await extractUserFacts({ ...base, people: [] }).catch(() => undefined)
    const corrective = llmChatCompletionMock.mock.calls[1]![0].messages.at(-1)
    expect(corrective.content).toMatch(/no Known people were offered/)
    expect(corrective.content).toMatch(/must be null/)

    llmChatCompletionMock.mockReset()
    llmChatCompletionMock
      .mockResolvedValueOnce(unknownStoredFact())
      .mockResolvedValueOnce(reply({ facts: [] }))
    await extractUserFacts({ ...base, storedFacts: [] })
    const second = llmChatCompletionMock.mock.calls[1]![0].messages.at(-1)
    expect(second.content).toMatch(/no stored facts were offered/)
    expect(second.content).toMatch(/plain "add"/)
  })

  it('fails loud as before when the second reply is wrong too: exactly two calls, both rejected replies evicted', async () => {
    const evict = vi.fn(() => true)
    const first = unknownEntity()
    const second = unknownStoredFact()
    for (const response of [first, second]) {
      rememberEvalLlmCacheOrigin(response, { evict } as unknown as EvalLlmCache, {
        endpoint: 'chat',
        provider: 'p',
        model: 'm',
        body: {},
      })
    }
    llmChatCompletionMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    await expect(extractUserFacts(base)).rejects.toThrow(/user fact extraction/)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(evict).toHaveBeenCalledTimes(2)
  })

  it('does not re-ask for other contract errors (malformed JSON, bad kind): they fail into the ingest retry ladder as today', async () => {
    for (const content of [
      'Sorry, I cannot do that',
      JSON.stringify({ facts: [{ op: 'add', subject: { kind: 'user' }, kind: 'nonsense' }] }),
    ]) {
      llmChatCompletionMock.mockReset()
      llmChatCompletionMock.mockResolvedValue(reply(content))
      await expect(extractUserFacts(base)).rejects.toThrow(/user fact extraction/)
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    }
  })

  it('a clean reply is one call, no corrective message', async () => {
    llmChatCompletionMock.mockResolvedValue(good())
    await extractUserFacts(base)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })
})
