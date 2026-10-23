import { describe, expect, it } from 'vitest'
import { normalizeQuery, rowMatchesQuery } from './filter-matcher'

/**
 * ei app.js:1861-1880 — the list search. Plain substring on the row's visible
 * text: this is *filtering*, not semantic classification (docs/planning/
 * ei-redesign.md guardrails allow exactly this — no LLM needed to hide rows
 * that don't contain the typed words).
 */

describe('normalizeQuery', () => {
  it('trims and lowercases what was typed', () => {
    expect(normalizeQuery('  Atlas  ')).toBe('atlas')
    expect(normalizeQuery('GARten')).toBe('garten')
  })

  it('keeps an empty query empty', () => {
    expect(normalizeQuery('')).toBe('')
    expect(normalizeQuery('   ')).toBe('')
  })
})

describe('rowMatchesQuery (ei app.js:1869)', () => {
  it('matches every row while the query is empty', () => {
    expect(rowMatchesQuery('anything at all', '')).toBe(true)
    expect(rowMatchesQuery('', '   ')).toBe(true)
  })

  it('matches a row whose visible text contains the query', () => {
    expect(rowMatchesQuery('Call the studio about pricing', 'studio')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(rowMatchesQuery('Atlas onboarding review', 'ATLAS')).toBe(true)
    expect(rowMatchesQuery('GARTEN gießen', 'garten')).toBe(true)
  })

  it('matches partial words and phrases across word boundaries', () => {
    expect(rowMatchesQuery('a cat sat', 'at s')).toBe(true)
    expect(rowMatchesQuery('pricing call', 'cing ca')).toBe(true)
  })

  it('rejects rows whose visible text lacks the query', () => {
    expect(rowMatchesQuery('Call the studio', 'garden')).toBe(false)
    expect(rowMatchesQuery('', 'studio')).toBe(false)
  })
})
