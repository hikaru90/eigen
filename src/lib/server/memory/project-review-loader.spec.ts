import { describe, expect, it } from 'vitest'
import { resolveProjectReviewTaskStatus } from './project-review'

describe('resolveProjectReviewTaskStatus', () => {
  it('maps archived lifecycle to archived', () => {
    expect(resolveProjectReviewTaskStatus('archived', { status: 'open' })).toBe('archived')
  })

  it('maps completed lifecycle or metadata to done', () => {
    expect(resolveProjectReviewTaskStatus('completed', { status: 'open' })).toBe('done')
    expect(resolveProjectReviewTaskStatus('open', { status: 'completed' })).toBe('done')
  })

  it('maps open lifecycle + open metadata to open', () => {
    expect(resolveProjectReviewTaskStatus('open', { status: 'open' })).toBe('open')
    expect(resolveProjectReviewTaskStatus('open', {})).toBe('open')
  })
})
