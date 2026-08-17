import { describe, expect, it } from 'vitest'
import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
import {
  captureIndexingDetailMessage,
  captureIndexingListStatus,
  captureIndexingRetryEligible,
} from './capture-indexing-status'

function thought(
  overrides: Partial<
    Pick<CaptureSubmitResult, 'enrichmentComplete' | 'queueStatus' | 'queueError'>
  >,
): CaptureSubmitResult {
  return {
    id: 't1',
    normalizedText: 'hello',
    category: 'task',
    metadata: {},
    cues: [],
    enrichedAt: overrides.enrichmentComplete ? '2026-06-06T12:00:00.000Z' : null,
    entities: [],
    temporalEvents: [],
    linkedThoughts: [],
    attachedFiles: [],
    gtdProjectLabel: null,
    gtdIsNextAction: false,
    enrichmentComplete: false,
    queueStatus: null,
    ...overrides,
  }
}

describe('captureIndexingListStatus', () => {
  it('returns null when enrichment is complete', () => {
    expect(
      captureIndexingListStatus(
        thought({ enrichmentComplete: true, queueStatus: 'complete' }),
        true,
      ),
    ).toBeNull()
  })

  it('shows incomplete (not spinning) when queue is complete without enriched_at', () => {
    expect(captureIndexingListStatus(thought({ queueStatus: 'complete' }), false)).toEqual({
      label: 'Indexing incomplete',
      spinning: false,
      failed: true,
    })
  })

  it('shows background spinner only while actively polling', () => {
    expect(captureIndexingListStatus(thought({ queueStatus: null }), true)).toEqual({
      label: 'Indexing in background',
      spinning: true,
      failed: false,
    })
    expect(captureIndexingListStatus(thought({ queueStatus: null }), false)).toBeNull()
  })
  it('shows awaiting confirmation for confirmation-gate drafts', () => {
    expect(
      captureIndexingListStatus(thought({ queueStatus: 'awaiting_confirmation' }), false),
    ).toEqual({
      label: 'Awaiting confirmation',
      spinning: false,
      failed: false,
    })
  })
})

describe('captureIndexingDetailMessage', () => {
  it('describes incomplete queue-complete rows', () => {
    expect(captureIndexingDetailMessage(thought({ queueStatus: 'complete' }))).toContain('Retry')
  })

  it('describes awaiting confirmation drafts', () => {
    expect(
      captureIndexingDetailMessage(thought({ queueStatus: 'awaiting_confirmation' })),
    ).toContain('Confirm')
  })
})

describe('captureIndexingRetryEligible', () => {
  it('allows retry for queue-complete rows missing enriched_at', () => {
    expect(captureIndexingRetryEligible(thought({ queueStatus: 'complete' }), null)).toBe(true)
  })

  it('does not allow enrich retry while awaiting confirmation', () => {
    expect(
      captureIndexingRetryEligible(thought({ queueStatus: 'awaiting_confirmation' }), null),
    ).toBe(false)
  })
})
