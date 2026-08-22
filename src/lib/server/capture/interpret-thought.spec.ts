import { beforeEach, describe, expect, it, vi } from 'vitest'
import { interpretThoughtPreview } from './interpret-thought'

const {
  llmChatCompletionMock,
  ensureOntologyMock,
  loadOntologyMock,
  loadProfileMock,
  getDbMock,
} = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
  ensureOntologyMock: vi.fn(),
  loadOntologyMock: vi.fn(),
  loadProfileMock: vi.fn(),
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/ontology-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/ontology-db')>()
  return {
    ...actual,
    ensureUserOntologySeeded: ensureOntologyMock,
    loadOntologyForUser: loadOntologyMock,
  }
})

vi.mock('$lib/server/ontology/classify-thought-category', () => ({
  loadUserOntologyProfileRow: loadProfileMock,
}))

function mockLlmContent(content: string) {
  llmChatCompletionMock.mockResolvedValue({
    choices: [{ message: { content } }],
  })
}

function makeOntology() {
  const kinds = [
    {
      id: 'ek-obs',
      key: 'observation',
      name: 'Observation',
      definition: 'Something noticed',
      kindType: 'thought_category' as const,
      active: true,
    },
    {
      id: 'ek-task',
      key: 'task',
      name: 'Task',
      definition: 'Something to do',
      kindType: 'thought_category' as const,
      active: true,
    },
    {
      id: 'ek-person',
      key: 'person',
      name: 'Person',
      definition: 'A person',
      kindType: 'entity_type' as const,
      active: true,
    },
  ]
  return {
    entityKinds: kinds,
    entityKindsByKey: new Map(kinds.map((k) => [k.key, k])),
  }
}

describe('interpretThoughtPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({})
    ensureOntologyMock.mockResolvedValue(undefined)
    loadOntologyMock.mockResolvedValue(makeOntology())
    loadProfileMock.mockResolvedValue({ version: 2 })
  })

  it('returns schema-conformant preview including LLM-judged deviatesFromVerbatim', async () => {
    mockLlmContent(
      JSON.stringify({
        interpretedText: 'Plan a team offsite in Lisbon next quarter.',
        category: { key: 'task', confidence: 0.91, alternatives: [{ key: 'observation', confidence: 0.2 }] },
        entities: [{ surface: 'Lisbon', entityType: 'person', confidence: 0.4 }],
        deviatesFromVerbatim: true,
      }),
    )

    const out = await interpretThoughtPreview({
      userId: 'u1',
      rawText: 'planning a team offsite in Lisbon next quarter',
    })

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(llmChatCompletionMock.mock.calls[0][0].responseFormat).toBe('json_object')
    const systemMsg = (
      llmChatCompletionMock.mock.calls[0][0].messages as Array<{ role: string; content: string }>
    ).find((m) => m.role === 'system')?.content
    expect(systemMsg).toContain('deviatesFromVerbatim')
    expect(out.interpretedText).toBe('Plan a team offsite in Lisbon next quarter.')
    expect(out.category.key).toBe('task')
    expect(out.category.confidence).toBeCloseTo(0.91)
    expect(out.deviatesFromVerbatim).toBe(true)
    expect(out.entities).toEqual([
      { surface: 'Lisbon', entityType: 'person', confidence: 0.4 },
    ])
  })

  it('parses false when the LLM judges no meaningful deviation', async () => {
    mockLlmContent(
      JSON.stringify({
        interpretedText: 'Buy oat milk',
        category: { key: 'task', confidence: 0.88, alternatives: [] },
        entities: [],
        deviatesFromVerbatim: false,
      }),
    )

    const out = await interpretThoughtPreview({
      userId: 'u1',
      rawText: 'buy oat milk',
    })
    expect(out.deviatesFromVerbatim).toBe(false)
  })

  it('rejects when LLM omits required deviatesFromVerbatim boolean', async () => {
    mockLlmContent(
      JSON.stringify({
        interpretedText: 'Hello',
        category: { key: 'observation', confidence: 0.8, alternatives: [] },
        entities: [],
      }),
    )

    await expect(interpretThoughtPreview({ userId: 'u1', rawText: 'hello' })).rejects.toThrow(
      /deviatesFromVerbatim/i,
    )
  })

  it('includes prior preview and correction in the LLM user message when correcting', async () => {
    mockLlmContent(
      JSON.stringify({
        interpretedText: 'Plan a team offsite in Porto next quarter.',
        category: { key: 'task', confidence: 0.9, alternatives: [] },
        entities: [{ surface: 'Porto', entityType: 'person', confidence: 0.5 }],
        deviatesFromVerbatim: true,
      }),
    )

    await interpretThoughtPreview({
      userId: 'u1',
      rawText: 'planning a team offsite in Lisbon next quarter',
      priorPreview: {
        interpretedText: 'Plan a team offsite in Lisbon next quarter.',
        category: { key: 'task', confidence: 0.91, alternatives: [] },
        entities: [{ surface: 'Lisbon', entityType: 'person', confidence: 0.4 }],
        deviatesFromVerbatim: true,
      },
      correction: 'Change the city to Porto',
    })

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const messages = llmChatCompletionMock.mock.calls[0][0].messages as Array<{
      role: string
      content: string
    }>
    const userMsg = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMsg).toContain('Change the city to Porto')
    expect(userMsg).toContain('Lisbon')
    expect(userMsg).toContain('priorPreview')
  })

  it('rejects empty raw text', async () => {
    await expect(interpretThoughtPreview({ userId: 'u1', rawText: '   ' })).rejects.toThrow(/raw/i)
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('rejects invalid category keys from the LLM (no synonym remapping)', async () => {
    mockLlmContent(
      JSON.stringify({
        interpretedText: 'Hello',
        category: { key: 'idea_note', confidence: 0.8, alternatives: [] },
        entities: [],
        deviatesFromVerbatim: false,
      }),
    )

    await expect(interpretThoughtPreview({ userId: 'u1', rawText: 'hello' })).rejects.toThrow(
      /category/i,
    )
  })

  it('parses fenced JSON from the LLM response', async () => {
    mockLlmContent(
      '```json\n' +
        JSON.stringify({
          interpretedText: 'Buy oat milk',
          category: { key: 'task', confidence: 0.88, alternatives: [] },
          entities: [],
          deviatesFromVerbatim: false,
        }) +
        '\n```',
    )

    const out = await interpretThoughtPreview({
      userId: 'u1',
      rawText: 'buy oat milk',
    })
    expect(out.interpretedText).toBe('Buy oat milk')
    expect(out.category.key).toBe('task')
    expect(out.deviatesFromVerbatim).toBe(false)
  })
})
