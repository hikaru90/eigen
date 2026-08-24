import type { CaptureSubmitResult } from './capture-result-types'
import { describe, expect, it } from 'vitest'
import {
  isAgentAuthoredCapture,
  matchesCaptureAuthorFilter,
  recentListHasAgentCaptures,
  recentThoughtPrimaryLabel,
  recentThoughtSecondaryLabel,
} from './recent-thought-display'

const snippet = {
  id: 't1',
  normalizedText: 'Recipe text',
  category: 'observation',
  createdAt: '2026-06-06T10:00:00.000Z',
}

describe('recentThoughtPrimaryLabel', () => {
  it('uses snippet category when capture detail is missing', () => {
    expect(recentThoughtPrimaryLabel(undefined, snippet)).toBe('observation')
  })

  it('shows indexed when enriched with placeholder category only', () => {
    expect(
      recentThoughtPrimaryLabel(
        {
          category: 'observation',
          enrichmentComplete: true,
        } as CaptureSubmitResult,
        {
          id: 't1',
          normalizedText: 'Recipe text',
          category: 'observation',
          createdAt: '2026-06-06T10:00:00.000Z',
        },
      ),
    ).toBe('indexed')
  })

  it('shows category while pending enrich', () => {
    expect(
      recentThoughtPrimaryLabel(
        {
          category: 'observation',
          enrichmentComplete: false,
          queueStatus: 'pending',
        } as CaptureSubmitResult,
        undefined,
      ),
    ).toBe('observation')
  })
})

describe('recentThoughtSecondaryLabel', () => {
  it('returns null for placeholder category rows', () => {
    expect(recentThoughtSecondaryLabel(undefined, snippet)).toBeNull()
  })

  it('returns the resolved category when it is not the placeholder', () => {
    expect(
      recentThoughtSecondaryLabel(
        {
          category: 'reference',
        } as CaptureSubmitResult,
        undefined,
      ),
    ).toBe('reference')
  })
})

describe('capture author filter', () => {
  const agentSnippet = {
    ...snippet,
    id: 'agent-1',
    author: 'agent' as const,
    authorLabel: 'cursor',
  }

  it('detects agent-authored captures', () => {
    expect(isAgentAuthoredCapture(undefined, agentSnippet)).toBe(true)
    expect(isAgentAuthoredCapture({ author: 'user' } as CaptureSubmitResult, agentSnippet)).toBe(
      false,
    )
  })

  it('filters human vs agent rows', () => {
    expect(matchesCaptureAuthorFilter('agent', undefined, agentSnippet)).toBe(true)
    expect(matchesCaptureAuthorFilter('human', undefined, agentSnippet)).toBe(false)
    expect(matchesCaptureAuthorFilter('all', undefined, agentSnippet)).toBe(true)
  })

  it('shows filter when any recent row is agent-authored', () => {
    expect(recentListHasAgentCaptures([snippet, agentSnippet], {})).toBe(true)
    expect(recentListHasAgentCaptures([snippet], {})).toBe(false)
  })
})
