import { describe, expect, it } from 'vitest'
import {
  categoryConfidencePercent,
  formatEntityConnection,
  formatEntityDecision,
  formatNearDuplicate,
  hasCaptureGraphContext,
  parseCategoryAlternatives,
} from './capture-result-display'
import type { CaptureSubmitResult } from './capture-result-types'

describe('capture-result-display', () => {
  it('parses category alternatives', () => {
    expect(
      parseCategoryAlternatives({
        categoryAlternatives: [{ key: 'idea', confidence: 0.41 }, { confidence: 0.2 }],
      }),
    ).toEqual([{ key: 'idea', confidence: 0.41 }])
  })

  it('formats category confidence', () => {
    expect(categoryConfidencePercent({ categoryConfidence: 0.826 })).toBe('83%')
    expect(categoryConfidencePercent({})).toBeNull()
  })

  it('formats near duplicate metadata', () => {
    expect(
      formatNearDuplicate({
        nearDuplicate: { distance: 0.031, preview: 'similar thought' },
      }),
    ).toBe('distance 0.031 — "similar thought"')
  })

  it('formats entity extraction and node connection', () => {
    expect(formatEntityDecision('merged')).toBe('linked to existing node')
    expect(formatEntityDecision('created')).toBe('new node created')
    expect(
      formatEntityConnection({
        entityId: 'e1',
        label: 'Eigen',
        entityType: 'project',
        mentionSurface: 'Eigen',
        decision: 'merged',
      }),
    ).toBe('"Eigen" → Eigen (project)')
  })

  it('detects graph context', () => {
    const empty: CaptureSubmitResult = {
      id: 't1',
      normalizedText: 'x',
      category: 'task',
      metadata: {},
      cues: [],
      enrichedAt: null,
      entities: [],
      temporalEvents: [],
      linkedThoughts: [],
      attachedFiles: [],
      enrichmentComplete: false,
    }
    expect(hasCaptureGraphContext(empty)).toBe(false)
    expect(
      hasCaptureGraphContext({
        ...empty,
        entities: [
          {
            entityId: 'e1',
            label: 'Eigen',
            entityType: 'project',
            mentionSurface: 'Eigen',
            decision: 'merged',
          },
        ],
      }),
    ).toBe(true)
  })
})
