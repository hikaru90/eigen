import type { McqOptions } from './mcq'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '$lib/server/llm/llm-client'
import type { ComposedAnswer } from '$lib/server/qa/compose-answer'
import { chooseFromComposed, storedContextItems } from './eigen-answer'

const item = (id: string, text: string, day: string, score = 0.5) => ({
  id,
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
        normalizedText: 'Likes green tea',
        score: 0.5,
        createdAt: '2025-01-02T10:00:00.000Z',
      },
      {
        id: 't2',
        normalizedText: 'Dislikes coffee',
        score: 0.3,
        createdAt: '2025-01-03T10:00:00.000Z',
      },
    ])
    expect(JSON.stringify(stored)).not.toContain('embedding')
  })
})
