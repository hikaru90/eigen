import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock } = vi.hoisted(() => ({ llmChatCompletionMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import {
  rememberEvalLlmCacheOrigin,
  type EvalLlmCache,
  type EvalLlmCacheRequest,
} from '$lib/server/llm/eval-llm-cache'
import {
  USER_FACT_CANDIDATE_PROMPT,
  buildFactCandidateMessages,
  extractFactCandidates,
  type KnownPerson,
} from './extract-user-facts'
import { SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'

const E_MIA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CAPTURED_AT = new Date('2026-06-02T08:30:00.000Z')

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
  people,
}

const miaCandidate = (entity: string | null) => ({
  statement: 'Mia (friend) keeps getting headaches',
  subject: 'Mia (friend)',
  entity,
  inferred: false,
})

beforeEach(() => llmChatCompletionMock.mockReset())

describe('USER_FACT_CANDIDATE_PROMPT: the chat model only proposes', () => {
  it('asks for candidate statements about people, also from reference material, and that a separate judge decides the rest', () => {
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/candidate/i)
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/about people/i)
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/reference text is read only for what it reveals about people/i)
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/A separate judge decides/)
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/any language/i)
  })

  it('decides nothing: no keep/drop rule, no confidence, no op, no fact kind, no reconciliation', () => {
    for (const decision of [
      /confidence/i,
      /\bsupersedes\b/,
      /\bconfirms\b/,
      /"op"/,
      /"add"/,
      /"update"/,
      /"confirm"/,
      /fact kind/i,
      /kind is one of: preference/,
      /0\.7/,
      /Never a fact/i,
      /stored facts/i,
    ]) {
      expect(USER_FACT_CANDIDATE_PROMPT).not.toMatch(decision)
    }
  })

  it('names the contract: candidates with statement, subject label, entity ref, inferred and identifier', () => {
    expect(USER_FACT_CANDIDATE_PROMPT).toContain(
      '{"candidates":[{"statement":"<statement>","subject":"<person label>"|null,"entity":"<E-ref>"|null,"inferred":true|false,"identifier":null|{',
    )
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/null when the statement is about the user/)
  })

  it('attributes statements to the right person and never to the user for what is said about a friend', () => {
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/statement about that friend, never about the user/i)
  })

  it('keeps identifier values out of the statement via the placeholder and keeps credentials out entirely', () => {
    expect(USER_FACT_CANDIDATE_PROMPT).toContain(SECURE_VALUE_PLACEHOLDER)
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/value must never appear in "statement"/)
    expect(USER_FACT_CANDIDATE_PROMPT).toMatch(/Credentials/)
  })
})

describe('buildFactCandidateMessages', () => {
  it('sends the capture, the capture date and the known people by ref — never an id', () => {
    const { messages } = buildFactCandidateMessages({ ...base, referenceText: null })
    expect(messages[0]).toEqual({ role: 'system', content: USER_FACT_CANDIDATE_PROMPT })
    const user = messages[1]!.content
    expect(user).toContain(base.text)
    expect(user).toContain('2026-06-02')
    expect(user).toContain('[E1] Mia')
    expect(user).not.toContain(E_MIA)
  })

  it('shows no stored facts: reconciliation is not the chat model\'s business any more', () => {
    const user = buildFactCandidateMessages({ ...base, referenceText: null }).messages[1]!.content
    expect(user).not.toMatch(/stored facts/i)
    expect(user).not.toContain('[F1]')
  })

  it('includes the reference text only when there is one, labelled as reference', () => {
    const without = buildFactCandidateMessages({ ...base, referenceText: null }).messages[1]!.content
    expect(without).not.toMatch(/reference text that came/i)
    const withRef = buildFactCandidateMessages({
      ...base,
      referenceText: 'Dear Prof. Lee, an early morning out on the waves before the keynote',
    }).messages[1]!.content
    expect(withRef).toContain('an early morning out on the waves before the keynote')
    expect(withRef).toMatch(/reference text/i)
  })

  it('says "none" instead of an empty list for no people', () => {
    const user = buildFactCandidateMessages({ ...base, people: [], referenceText: null }).messages[1]!
      .content
    expect(user).toMatch(/Known people from this capture:\nnone/)
  })

  it('keeps the capture out of the first 300 characters of the user message (the activity log keeps those)', () => {
    const user = buildFactCandidateMessages({ ...base, people: [], referenceText: null }).messages[1]!
      .content
    expect(user.slice(0, 300)).not.toContain(base.text)
    expect(user.indexOf(base.text)).toBeGreaterThan(300)
  })
})

describe('extractFactCandidates', () => {
  it('asks once in json mode and maps the entity ref back to the graph person', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ candidates: [miaCandidate('E1')] }))

    const out = await extractFactCandidates(base)

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const call = llmChatCompletionMock.mock.calls[0]![0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.logContext).toBe('user_fact_extraction')
    expect(call.userId).toBe('u1')
    expect(out).toEqual([
      {
        statement: 'Mia (friend) keeps getting headaches',
        subjectLabel: 'Mia (friend)',
        entityId: E_MIA,
        inferred: false,
        identifier: null,
      },
    ])
  })

  it('nothing found: still one call, empty result', async () => {
    llmChatCompletionMock.mockResolvedValue(reply({ candidates: [] }))
    expect(await extractFactCandidates({ ...base, people: [], text: 'Recipe: 200 g flour' })).toEqual([])
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('throws on an empty or malformed reply and evicts the rejected reply from the eval cache', async () => {
    const evict = vi.fn(() => true)
    const cache = { evict } as unknown as EvalLlmCache
    const request: EvalLlmCacheRequest = { endpoint: 'chat', provider: 'p', model: 'm', body: {} }

    for (const content of ['', 'Sorry, I cannot do that', '{"candidates":"x"}', '{"facts":[]}']) {
      evict.mockClear()
      const response = reply(content)
      rememberEvalLlmCacheOrigin(response, cache, request)
      llmChatCompletionMock.mockResolvedValue(response)
      await expect(extractFactCandidates(base)).rejects.toThrow(/user fact extraction/)
      expect(evict).toHaveBeenCalledWith(request)
    }
  })

  it('does not evict a reply it accepted', async () => {
    const evict = vi.fn(() => true)
    const response = reply({ candidates: [] })
    rememberEvalLlmCacheOrigin(response, { evict } as unknown as EvalLlmCache, {
      endpoint: 'chat',
      provider: 'p',
      model: 'm',
      body: {},
    })
    llmChatCompletionMock.mockResolvedValue(response)
    await extractFactCandidates(base)
    expect(evict).not.toHaveBeenCalled()
  })

  it('an error about a bad reply never repeats the capture or an identifier value', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        candidates: [
          {
            statement: 'The user parks the car at B-XY 4711',
            subject: null,
            entity: null,
            inferred: false,
            identifier: { kind: 'licence_plate', label: 'plate', value: 'B-XY 4711' },
          },
        ],
      }),
    )
    const err = await extractFactCandidates({ ...base, text: 'my plate is B-XY 4711' }).catch(
      (e) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).not.toContain('B-XY 4711')
    expect(String((err as Error).message)).not.toContain('my plate')
  })

  it('a reply that still carries decisions (op, kind, confidence) changes nothing: they are not read', async () => {
    llmChatCompletionMock.mockResolvedValue(
      reply({
        candidates: [
          { ...miaCandidate(null), op: 'update', supersedes: 'F1', kind: 'health', confidence: 0.99 },
        ],
      }),
    )
    const out = await extractFactCandidates(base)
    expect(Object.keys(out[0]!).sort()).toEqual([
      'entityId',
      'identifier',
      'inferred',
      'statement',
      'subjectLabel',
    ])
  })
})

describe('extractFactCandidates: an unknown known-person ref is re-asked once', () => {
  const unknownEntity = () => reply({ candidates: [miaCandidate('E9')] })
  const good = () => reply({ candidates: [miaCandidate('E1')] })

  it('one corrective re-ask, the bad reply evicted, the corrected reply used', async () => {
    const evict = vi.fn(() => true)
    const bad = unknownEntity()
    rememberEvalLlmCacheOrigin(bad, { evict } as unknown as EvalLlmCache, {
      endpoint: 'chat',
      provider: 'p',
      model: 'm',
      body: {},
    })
    llmChatCompletionMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(good())

    const out = await extractFactCandidates(base)

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(evict).toHaveBeenCalledTimes(1)
    expect(out).toEqual([expect.objectContaining({ subjectLabel: 'Mia (friend)', entityId: E_MIA })])
  })

  it('the re-ask keeps the original messages, then the bad reply and a short corrective message that never repeats the bad ref', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(unknownEntity()).mockResolvedValueOnce(good())

    await extractFactCandidates(base)

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

  it('when no known people were offered, the correction says so instead of listing refs', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(unknownEntity()).mockResolvedValueOnce(good())
    await extractFactCandidates({ ...base, people: [] }).catch(() => undefined)
    const corrective = llmChatCompletionMock.mock.calls[1]![0].messages.at(-1)
    expect(corrective.content).toMatch(/no Known people were offered/)
    expect(corrective.content).toMatch(/must be null/)
  })

  it('fails loud as before when the second reply is wrong too: exactly two calls, both rejected replies evicted', async () => {
    const evict = vi.fn(() => true)
    const first = unknownEntity()
    const second = unknownEntity()
    for (const response of [first, second]) {
      rememberEvalLlmCacheOrigin(response, { evict } as unknown as EvalLlmCache, {
        endpoint: 'chat',
        provider: 'p',
        model: 'm',
        body: {},
      })
    }
    llmChatCompletionMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    await expect(extractFactCandidates(base)).rejects.toThrow(/user fact extraction/)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(evict).toHaveBeenCalledTimes(2)
  })

  it('does not re-ask for other contract errors (malformed JSON, a missing inferred): they fail into the ingest retry ladder', async () => {
    for (const content of [
      'Sorry, I cannot do that',
      JSON.stringify({ candidates: [{ statement: 'x', subject: null }] }),
    ]) {
      llmChatCompletionMock.mockReset()
      llmChatCompletionMock.mockResolvedValue(reply(content))
      await expect(extractFactCandidates(base)).rejects.toThrow(/user fact extraction/)
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    }
  })

  it('a clean reply is one call, no corrective message', async () => {
    llmChatCompletionMock.mockResolvedValue(good())
    await extractFactCandidates(base)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })
})
