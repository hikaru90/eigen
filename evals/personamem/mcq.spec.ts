import { describe, expect, it } from 'vitest'
import { buildChooserMessages, buildOptions } from './mcq'

const row = {
  personaId: 7,
  query: 'Suggest a drink for tonight.',
  correctAnswer: 'Green tea.',
  incorrectAnswers: ['Black tea.', 'Espresso.', 'Milk shake.'] as [string, string, string],
}

describe('buildOptions', () => {
  it('is a permutation of the correct and the three incorrect answers', () => {
    const { options } = buildOptions(row)
    expect(Object.keys(options)).toEqual(['A', 'B', 'C', 'D'])
    expect(Object.values(options).sort()).toEqual(
      ['Black tea.', 'Espresso.', 'Green tea.', 'Milk shake.'].sort(),
    )
  })

  it('maps correctLetter back to the correct answer', () => {
    const { options, correctLetter } = buildOptions(row)
    expect(options[correctLetter]).toBe('Green tea.')
  })

  it('is deterministic for the same persona and query, across calls', () => {
    expect(buildOptions(row)).toEqual(buildOptions({ ...row }))
  })

  it('shuffles per (persona, query): the correct letter is not pinned to one position', () => {
    const letters = new Set<string>()
    for (let personaId = 0; personaId < 40; personaId++) {
      letters.add(buildOptions({ ...row, personaId }).correctLetter)
    }
    expect(letters.size).toBe(4)
  })
})

describe('buildChooserMessages', () => {
  const { options } = buildOptions(row)

  it('lists the memories and all four options when memories are given', () => {
    const messages = buildChooserMessages({
      query: row.query,
      options,
      memories: [
        {
          text: 'Only drinks green tea in the evening.',
          storedAt: new Date('2025-01-02T00:00:00Z'),
        },
        { text: 'Avoids dairy.', storedAt: new Date('2025-01-04T23:59:59Z') },
      ],
    })
    const text = messages.map((m) => m.content).join('\n')
    expect(text).toContain('[1] (stored 2025-01-02) Only drinks green tea in the evening.')
    expect(text).toContain('[2] (stored 2025-01-04) Avoids dairy.')
    expect(text).toContain(row.query)
    for (const letter of ['A', 'B', 'C', 'D'] as const) {
      expect(text).toContain(`${letter}. ${options[letter]}`)
    }
    expect(messages[0]!.role).toBe('system')
    expect(messages.at(-1)!.role).toBe('user')
  })

  it('keeps the order it was given, even when dates are not ascending', () => {
    const messages = buildChooserMessages({
      query: row.query,
      options,
      memories: [
        { text: 'newer first', storedAt: new Date('2025-03-09T00:00:00Z') },
        { text: 'older second', storedAt: new Date('2025-01-01T00:00:00Z') },
      ],
    })
    const text = messages.at(-1)!.content
    expect(text.indexOf('[1] (stored 2025-03-09) newer first')).toBeGreaterThan(-1)
    expect(text.indexOf('[1] (stored 2025-03-09) newer first')).toBeLessThan(
      text.indexOf('[2] (stored 2025-01-01) older second'),
    )
  })

  it('states there are no memories for the no-memory variant, and shows none', () => {
    const withMemories = buildChooserMessages({
      query: row.query,
      options,
      memories: [{ text: 'Likes tea.', storedAt: new Date('2025-01-02T00:00:00Z') }],
    })
    const without = buildChooserMessages({ query: row.query, options, memories: null })
    const text = without.map((m) => m.content).join('\n')
    expect(text).not.toContain('Likes tea.')
    expect(text).toMatch(/no stored memories/i)
    expect(without[0]!.content).toBe(withMemories[0]!.content)
  })

  it('tells an empty retrieval apart from the no-memory variant only by the memory block text', () => {
    const empty = buildChooserMessages({ query: row.query, options, memories: [] })
    expect(empty.map((m) => m.content).join('\n')).toMatch(/retrieved no memories/i)
  })
})
