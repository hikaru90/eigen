import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evidenceToCaptures, historyToCaptures, PERSONAMEM_EPOCH } from './history-to-captures'
import { loadHistory } from './load-dataset'
import { FIXTURES_DIR } from './test-fixtures'

const DAY_MS = 24 * 60 * 60 * 1000

describe('historyToCaptures', () => {
  const history = loadHistory(join(FIXTURES_DIR, 'chat_history_fixture_persona7.json'))

  it('keeps only user turns, in order (system and assistant turns are dropped)', () => {
    const captures = historyToCaptures(history)
    expect(captures.map((c) => c.rawText)).toEqual([
      'I only drink green tea in the evening, never black tea.',
      'Usually a few almonds. I try to avoid sugar these days.',
      'My knees ache after gardening, so I kneel on a foam pad.',
      "Please don't suggest anything with dairy, it upsets my stomach.",
      'I plan to plant tomatoes next to the south fence this spring.',
    ])
  })

  it('stamps capturedAt strictly increasing by one day from the fixed epoch', () => {
    const captures = historyToCaptures(history)
    expect(PERSONAMEM_EPOCH.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    expect(captures.map((c) => c.capturedAt.toISOString())).toEqual([
      '2025-01-01T00:00:00.000Z',
      '2025-01-02T00:00:00.000Z',
      '2025-01-03T00:00:00.000Z',
      '2025-01-04T00:00:00.000Z',
      '2025-01-05T00:00:00.000Z',
    ])
  })

  it('gives every turn a distinct calendar date (composeAnswer shows stored=YYYY-MM-DD)', () => {
    const dates = historyToCaptures(history).map((c) => c.capturedAt.toISOString().slice(0, 10))
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('stays under the 6-month staleness threshold even for a history far longer than the dataset max (~136 user turns)', () => {
    const long = {
      chat_history: Array.from({ length: 150 }, (_, i) => ({
        role: 'user' as const,
        content: `turn ${i}`,
      })),
    }
    const captures = historyToCaptures(long)
    const spanDays =
      (captures[captures.length - 1]!.capturedAt.getTime() - captures[0]!.capturedAt.getTime()) /
      DAY_MS
    expect(spanDays).toBeLessThan(180)
  })

  it('throws on an empty user turn, naming its position', () => {
    const broken = {
      chat_history: [
        { role: 'system' as const, content: 's' },
        { role: 'user' as const, content: 'fine' },
        { role: 'user' as const, content: '   ' },
      ],
    }
    expect(() => historyToCaptures(broken)).toThrow(/message 2/)
  })

  it('throws when a history has no user turn at all', () => {
    expect(() => historyToCaptures({ chat_history: [{ role: 'system', content: 's' }] })).toThrow(
      /no user turns/,
    )
  })
})

describe('evidenceToCaptures', () => {
  it('keeps only user turns in snippet order, one day apart from the epoch', () => {
    const captures = evidenceToCaptures([
      { role: 'user', content: ' first ' },
      { role: 'assistant', content: 'skipped' },
      { role: 'user', content: 'second' },
    ])
    expect(captures.map((c) => c.rawText)).toEqual(['first', 'second'])
    expect(captures.map((c) => c.capturedAt.getTime() - PERSONAMEM_EPOCH.getTime())).toEqual([
      0,
      DAY_MS,
    ])
  })

  it('throws without user turns or on a blank one', () => {
    expect(() => evidenceToCaptures([{ role: 'assistant', content: 'x' }])).toThrow(/no user turns/)
    expect(() => evidenceToCaptures([{ role: 'user', content: ' ' }])).toThrow(/empty user turn/)
  })
})
