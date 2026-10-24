import { describe, expect, it } from 'vitest'
import { parseCheckInQuestion } from './check-in'

describe('parseCheckInQuestion', () => {
  it('reads relevance and grounding questions', () => {
    expect(parseCheckInQuestion({ kind: 'relevance', thoughtId: 't1', snippet: 's', question: 'Still?' })).toEqual({
      kind: 'relevance',
      thoughtId: 't1',
      snippet: 's',
      question: 'Still?',
    })
    expect(parseCheckInQuestion({ kind: 'grounding', facetKey: 'work', question: 'Where?' })).toEqual({
      kind: 'grounding',
      facetKey: 'work',
      question: 'Where?',
    })
  })

  it('is null when there is no usable question', () => {
    expect(parseCheckInQuestion(null)).toBeNull()
    expect(parseCheckInQuestion({ question: '  ' })).toBeNull()
    expect(parseCheckInQuestion({ kind: 'relevance', question: 'x' })).toBeNull()
  })
})
