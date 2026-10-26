import type { McqOptions } from './mcq'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '$lib/server/llm/llm-client'
import type { ComposedAnswer } from '$lib/server/qa/compose-answer'
import { chooseFromComposed, storedContextItems } from './eigen-answer'

const item = (id: string, text: string, day: string, score = 0.5) => ({
  id,
  kind: 'thought' as const,
  normalizedText: text,
  score,
  createdAt: new Date(`${day}T10:00:00.000Z`),
  category: 'fact',
  vectorScore: 0.4,
  graphScore: 0.1,
  embedding: [0.1, 0.2],
})

const cited = item('t1', 'Likes green tea', '2025-01-02')
const uncited = item('t2', 'Dislikes coffee', '2025-01-03', 0.3)
const composed = {
  answer: 'Not in memory',
  retrieved: [cited],
  context: [cited, uncited],
} as unknown as ComposedAnswer

const mcq: McqOptions = {
  options: { A: 'tea', B: 'coffee', C: 'milk', D: 'water' },
  correctLetter: 'A',
}

describe('chooseFromComposed', () => {
  it('shows the chooser every context item, dated, not only the cited ones', async () => {
    const complete = vi.fn(async (_messages: ChatMessage[]) => ({
      content: '{"letter":"B"}',
      reject: vi.fn(),
    }))
    const letter = await chooseFromComposed({
      composed,
      query: 'a drink?',
      options: mcq.options,
      complete,
    })
    expect(letter).toBe('B')
    const prompt = JSON.stringify(complete.mock.calls[0]![0])
    expect(prompt).toContain('(stored 2025-01-02) Likes green tea')
    expect(prompt).toContain('(stored 2025-01-03) Dislikes coffee')
  })

  it('an empty context yields the "retrieved no memories" block', async () => {
    const complete = vi.fn(async (_messages: ChatMessage[]) => ({
      content: '{"letter":"A"}',
      reject: vi.fn(),
    }))
    await chooseFromComposed({
      composed: { ...composed, context: [], retrieved: [] } as unknown as ComposedAnswer,
      query: 'q',
      options: mcq.options,
      complete,
    })
    expect(JSON.stringify(complete.mock.calls[0]![0])).toContain('retrieved no memories')
  })
})

describe('storedContextItems', () => {
  it('keeps only id, normalizedText, score, createdAt - no embeddings or other fields', () => {
    const stored = storedContextItems(composed)
    expect(stored).toEqual([
      {
        id: 't1',
        kind: 'thought',
        normalizedText: 'Likes green tea',
        score: 0.5,
        createdAt: '2025-01-02T10:00:00.000Z',
      },
      {
        id: 't2',
        kind: 'thought',
        normalizedText: 'Dislikes coffee',
        score: 0.3,
        createdAt: '2025-01-03T10:00:00.000Z',
      },
    ])
    expect(JSON.stringify(stored)).not.toContain('embedding')
  })
})

describe('fact items in the chooser context (docs/planning/user-facts-layer.md, F2)', () => {
  const SECURE_ID = '11111111-1111-4111-8111-111111111111'
  const fact = (id: string, text: string, day: string) => ({
    ...item(id, text, day, 0.6),
    kind: 'fact' as const,
    category: 'fact',
    fact: { subject: 'Mia (friend)', subjectKind: 'person', factKind: 'health', inferred: true },
  })
  const withFacts = {
    answer: 'x',
    retrieved: [],
    context: [
      item('t1', 'Likes green tea', '2025-01-02'),
      fact('f1', 'Fact about Mia (friend): Mia (friend) barely drinks water', '2026-03-05'),
      fact(
        'f2',
        `Fact about the user: The user's licence plate is [secure:${SECURE_ID}]`,
        '2026-03-02',
      ),
    ],
  } as unknown as ComposedAnswer

  it('the chooser reads a fact like any memory: numbered, dated by its as-of day, with its subject', async () => {
    const complete = vi.fn(async (_messages: ChatMessage[]) => ({
      content: '{"letter":"A"}',
      reject: vi.fn(),
    }))
    await chooseFromComposed({
      composed: withFacts,
      query: 'how much water should I drink?',
      options: mcq.options,
      complete,
    })
    const prompt = complete.mock.calls[0]![0].map((m) => m.content).join('\n')
    expect(prompt).toContain('[1] (stored 2025-01-02) Likes green tea')
    expect(prompt).toContain(
      '[2] (stored 2026-03-05) Fact about Mia (friend): Mia (friend) barely drinks water',
    )
    expect(prompt).toContain('[3] (stored 2026-03-02) Fact about the user:')
  })

  it('is stored with kind fact, an identifier only as its reference (no value, no embedding)', () => {
    const stored = storedContextItems(withFacts)
    expect(stored.map((s) => s.kind)).toEqual(['thought', 'fact', 'fact'])
    expect(stored[1]).toEqual({
      id: 'f1',
      kind: 'fact',
      normalizedText: 'Fact about Mia (friend): Mia (friend) barely drinks water',
      score: 0.6,
      createdAt: '2026-03-05T10:00:00.000Z',
    })
    expect(stored[2]!.normalizedText).toContain(`[secure:${SECURE_ID}]`)
    const json = JSON.stringify(stored)
    expect(json).not.toContain('embedding')
    expect(json).not.toContain('subjectKind')
  })
})
