import { describe, expect, it } from 'vitest'
import { ASK_SUGGESTION_COUNT, pickAskSuggestions } from './ask-suggestions'

const row = (thoughtId: string, question: string | null) => ({ thoughtId, question })

describe('pickAskSuggestions — "Try asking" from stored enrichment questions (SQ-4)', () => {
  it('keeps the three newest questions in the given (newest-first) order (AC-4)', () => {
    expect(ASK_SUGGESTION_COUNT).toBe(3)
    const out = pickAskSuggestions([
      row('e', 'When is the dentist appointment?'),
      row('d', 'What did I need to call the plumber about?'),
      row('c', 'Who recommended the book?'),
      row('b', 'Where is the offsite?'),
      row('a', 'What was the wifi password hint?'),
    ])
    expect(out).toEqual([
      { thoughtId: 'e', question: 'When is the dentist appointment?' },
      { thoughtId: 'd', question: 'What did I need to call the plumber about?' },
      { thoughtId: 'c', question: 'Who recommended the book?' },
    ])
  })

  it('shows an identical question once, after whitespace normalisation', () => {
    const out = pickAskSuggestions([
      row('c', 'Where is  the offsite?'),
      row('b', ' Where is the offsite? '),
      row('a', 'Who recommended the book?'),
    ])
    expect(out).toEqual([
      { thoughtId: 'c', question: 'Where is the offsite?' },
      { thoughtId: 'a', question: 'Who recommended the book?' },
    ])
  })

  it('skips rows without a question and never invents one (AC-6)', () => {
    expect(pickAskSuggestions([row('a', null), row('b', '   ')])).toEqual([])
    expect(pickAskSuggestions([])).toEqual([])
  })
})
