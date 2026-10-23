import { describe, expect, it } from 'vitest'
import {
  ASK_SUGGESTION_COUNT,
  ASK_SUGGESTION_MAX_CHARS,
  suggestionsFromRecentThoughts,
} from './ask-suggestions'

const row = (id: string, normalizedText: string) => ({ id, normalizedText })

describe('suggestionsFromRecentThoughts — "Try asking" pills from your own words', () => {
  it('takes at most three thoughts, in order, keeping their ids', () => {
    const out = suggestionsFromRecentThoughts([
      row('a', 'Call Jonas about the lease'),
      row('b', 'Morning pages before the laptop opens'),
      row('c', 'One long table matters more than desks'),
      row('d', 'Coffee after two wrecks the night'),
    ])
    expect(ASK_SUGGESTION_COUNT).toBe(3)
    expect(out).toEqual([
      { id: 'a', text: 'Call Jonas about the lease' },
      { id: 'b', text: 'Morning pages before the laptop opens' },
      { id: 'c', text: 'One long table matters more than desks' },
    ])
  })

  it('drops empty rows and collapses whitespace', () => {
    const out = suggestionsFromRecentThoughts([
      row('a', '   '),
      row('b', 'Lena’s birthday\n  is on the   24th'),
      row('c', ''),
    ])
    expect(out).toEqual([{ id: 'b', text: 'Lena’s birthday is on the 24th' }])
  })

  it('de-duplicates identical words so the three pills differ', () => {
    const out = suggestionsFromRecentThoughts([
      row('a', 'Test the name with five people'),
      row('b', 'test the name with five people'),
      row('c', 'A weekly review without the guilt'),
    ])
    expect(out.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('shortens long thoughts at a word boundary with one ellipsis', () => {
    const long =
      'Atlas is becoming a deliberately calm tool, closer to closing a notebook than clearing an inbox, and that is the whole point of it'
    const [only] = suggestionsFromRecentThoughts([row('a', long)])
    expect(only.text.length).toBeLessThanOrEqual(ASK_SUGGESTION_MAX_CHARS)
    expect(only.text.endsWith('…')).toBe(true)
    // never cut inside a word: the character before the ellipsis is not a letter being split
    const kept = only.text.slice(0, -1)
    expect(long.startsWith(kept)).toBe(true)
    expect(long.charAt(kept.length)).toBe(' ')
  })

  it('honours a smaller count when asked', () => {
    const out = suggestionsFromRecentThoughts(
      [row('a', 'one'), row('b', 'two'), row('c', 'three')],
      { count: 2 },
    )
    expect(out.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for no thoughts (the page then hides "Try asking")', () => {
    expect(suggestionsFromRecentThoughts([])).toEqual([])
  })
})
