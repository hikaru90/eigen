import { describe, expect, it } from 'vitest'
import { shouldRejectDestructiveRecentSync } from './reject-destructive-recent-sync'

describe('shouldRejectDestructiveRecentSync', () => {
  it('rejects empty server merge while local in-flight captures exist', () => {
    expect(
      shouldRejectDestructiveRecentSync(
        [
          {
            id: 'fresh',
            normalizedText: 'Lisbon offsite',
            category: 'observation',
            createdAt: '2026-06-06T18:00:00.000Z',
          },
        ],
        {
          fresh: {
            id: 'fresh',
            normalizedText: 'Lisbon offsite',
            category: 'observation',
            metadata: {},
            cues: [],
            enrichedAt: null,
            entities: [],
            temporalEvents: [],
            linkedThoughts: [],
            attachedFiles: [],
            enrichmentComplete: false,
            queueStatus: 'pending',
          },
        },
        [],
      ),
    ).toBe(true)
  })

  it('allows empty merge when local rows are fully enriched', () => {
    expect(
      shouldRejectDestructiveRecentSync(
        [
          {
            id: 'gone',
            normalizedText: 'gone',
            category: 'observation',
            createdAt: '2026-06-06T18:00:00.000Z',
          },
        ],
        {
          gone: {
            id: 'gone',
            normalizedText: 'gone',
            category: 'observation',
            metadata: {},
            cues: [],
            enrichedAt: '2026-06-06T18:00:00.000Z',
            entities: [],
            temporalEvents: [],
            linkedThoughts: [],
            attachedFiles: [],
            enrichmentComplete: true,
            queueStatus: 'complete',
          },
        },
        [],
      ),
    ).toBe(false)
  })
})
