import { describe, expect, it } from 'vitest'
import { GRAPH_SCALE_QA_QUERIES } from './measure-qa'

describe('GRAPH_SCALE_QA_QUERIES', () => {
  it('defines twenty theme-aligned questions for track B', () => {
    expect(GRAPH_SCALE_QA_QUERIES).toHaveLength(20)
  })

  it('uses unique non-empty natural-language questions', () => {
    const trimmed = GRAPH_SCALE_QA_QUERIES.map((q) => q.trim())
    expect(trimmed.every((q) => q.length > 0)).toBe(true)
    expect(new Set(trimmed).size).toBe(trimmed.length)
  })

  it('covers all single-thought corpus theme buckets', () => {
    const joined = GRAPH_SCALE_QA_QUERIES.join(' ').toLowerCase()
    for (const theme of [
      'errand',
      'appointment',
      'home',
      'work',
      'health',
      'financial',
      'administrative',
      'idea',
    ]) {
      expect(joined).toContain(theme)
    }
  })
})
