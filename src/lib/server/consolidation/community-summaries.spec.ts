import { describe, expect, it } from 'vitest'
import {
  buildBatchSummaryPrompt,
  parseBatchCommunityReports,
  CommunitySummaryBatchError,
  SUMMARY_LLM_BATCH_SIZE,
  DEFAULT_SUMMARY_REPORT_BUDGET,
  type CommunityContext,
} from './community-summaries'

describe('parseBatchCommunityReports', () => {
  const expected = ['c1', 'c2']

  it('accepts valid batch JSON with exact ids', () => {
    const content = JSON.stringify({
      reports: [
        { communityId: 'c1', title: 'Work projects', summary: 'Active initiatives.' },
        { communityId: 'c2', title: 'Home life', summary: 'Household themes.' },
      ],
    })
    const reports = parseBatchCommunityReports(content, expected)
    expect(reports).toHaveLength(2)
    expect(reports[0]?.communityId).toBe('c1')
  })

  it('rejects missing community id', () => {
    const content = JSON.stringify({
      reports: [{ communityId: 'c1', title: 'A', summary: 'B' }],
    })
    expect(() => parseBatchCommunityReports(content, expected)).toThrow(CommunitySummaryBatchError)
  })

  it('rejects duplicate ids', () => {
    const content = JSON.stringify({
      reports: [
        { communityId: 'c1', title: 'A', summary: 'B' },
        { communityId: 'c1', title: 'C', summary: 'D' },
      ],
    })
    expect(() => parseBatchCommunityReports(content, ['c1'])).toThrow(/duplicate communityId/)
  })

  it('rejects unexpected ids', () => {
    const content = JSON.stringify({
      reports: [{ communityId: 'other', title: 'A', summary: 'B' }],
    })
    expect(() => parseBatchCommunityReports(content, ['c1'])).toThrow(/missing report/)
  })

  it('rejects invalid JSON', () => {
    expect(() => parseBatchCommunityReports('not json', expected)).toThrow(/not valid JSON/)
  })
})

describe('buildBatchSummaryPrompt', () => {
  it('includes each community id block', () => {
    const contexts: CommunityContext[] = [
      {
        communityId: 'abc',
        level: 1,
        entityLabels: ['Eigen'],
        entityTypes: ['concept'],
        relatedThoughts: ['Building memory infra'],
        thoughtCount: 1,
      },
    ]
    const prompt = buildBatchSummaryPrompt(contexts)
    expect(prompt).toContain('communityId: abc')
    expect(prompt).toContain('Generate exactly 1 reports')
  })
})

describe('summary batching constants', () => {
  it('batches multiple communities per LLM call', () => {
    expect(SUMMARY_LLM_BATCH_SIZE).toBeGreaterThan(1)
    expect(DEFAULT_SUMMARY_REPORT_BUDGET).toBeGreaterThan(SUMMARY_LLM_BATCH_SIZE)
  })

  it('implies ceil(N/B) chat calls for N communities', () => {
    const n = 20
    const expectedCalls = Math.ceil(n / SUMMARY_LLM_BATCH_SIZE)
    expect(expectedCalls).toBeLessThan(n)
    expect(expectedCalls).toBe(Math.ceil(20 / 8))
  })
})
