import { describe, expect, it } from 'vitest'
import { ASK_QUESTION_MAX_CHARS, ASK_QUESTION_RULE, parseAskQuestion } from './ask-question'

describe('parseAskQuestion — enrichment contract for the Ask suggestion (SQ-2)', () => {
  it('trims a string question', () => {
    expect(parseAskQuestion({ askQuestion: '  What did I need to call the plumber about?  ' })).toBe(
      'What did I need to call the plumber about?',
    )
  })

  it('accepts null (no sensible question, AC-3)', () => {
    expect(parseAskQuestion({ askQuestion: null })).toBeNull()
  })

  it('accepts a question of exactly the cap and rejects one over it', () => {
    const atCap = `${'a'.repeat(ASK_QUESTION_MAX_CHARS - 1)}?`
    expect(parseAskQuestion({ askQuestion: atCap })).toBe(atCap)
    expect(() => parseAskQuestion({ askQuestion: `${atCap}x` })).toThrow(/askQuestion/)
  })

  it('rejects a missing key — never defaulted', () => {
    expect(() => parseAskQuestion({})).toThrow(/askQuestion/)
  })

  it('rejects wrong types and blank strings', () => {
    for (const bad of [42, true, ['q?'], { q: 'x' }, '', '   ']) {
      expect(() => parseAskQuestion({ askQuestion: bad })).toThrow(/askQuestion/)
    }
  })
})

describe('ASK_QUESTION_RULE — prompt contract', () => {
  it('states the cap, the language, the perspective, self-containedness and null', () => {
    expect(ASK_QUESTION_MAX_CHARS).toBe(90)
    expect(ASK_QUESTION_RULE).toContain('askQuestion')
    expect(ASK_QUESTION_RULE).toContain(String(ASK_QUESTION_MAX_CHARS))
    expect(ASK_QUESTION_RULE).toMatch(/same language/i)
    expect(ASK_QUESTION_RULE).toMatch(/first person|user's perspective/i)
    expect(ASK_QUESTION_RULE).toMatch(/this capture alone/i)
    expect(ASK_QUESTION_RULE).toMatch(/null/)
    expect(ASK_QUESTION_RULE).toMatch(/never copy/i)
  })
})
