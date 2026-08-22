import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadRelevanceCheckInCandidates } from '$lib/server/grounding/relevance-candidates'

const { whereMock, loadOntologyMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
  loadOntologyMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: whereMock,
      })),
    })),
  }),
}))

vi.mock('$lib/server/ontology-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/ontology-db')>()
  return {
    ...actual,
    loadOntologyForUser: loadOntologyMock,
  }
})

describe('loadRelevanceCheckInCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadOntologyMock.mockResolvedValue({
      entityKinds: [
        {
          id: 'ek-fact',
          key: 'fact',
          name: 'Fact',
          definition: 'Durable fact',
          kindType: 'thought_category',
          active: true,
          neverStale: true,
        },
      ],
      entityKindsByKey: new Map([
        [
          'fact',
          {
            id: 'ek-fact',
            key: 'fact',
            name: 'Fact',
            definition: 'Durable fact',
            kindType: 'thought_category',
            active: true,
            neverStale: true,
          },
        ],
      ]),
    })
    const old = new Date(Date.now() - 40 * 86_400_000)
    whereMock.mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            id: 't-old',
            normalizedText: 'Faded note',
            category: 'idea',
            salienceScore: 0.3,
            lastAccessedAt: null,
            createdAt: old,
            metadata: {},
          },
          {
            id: 't-fact',
            normalizedText: 'Durable fact',
            category: 'fact',
            salienceScore: 0.2,
            lastAccessedAt: null,
            createdAt: old,
            metadata: {},
          },
          {
            id: 't-fresh',
            normalizedText: 'Recent enough',
            category: 'idea',
            salienceScore: 0.5,
            lastAccessedAt: new Date(),
            createdAt: old,
            metadata: {},
          },
        ]),
      }),
    })
  })

  it('keeps inactive non-exempt thoughts and drops never-stale / fresh ones', async () => {
    const candidates = await loadRelevanceCheckInCandidates('u1', 12)
    expect(candidates.map((c) => c.id)).toEqual(['t-old'])
    expect(candidates[0]?.inactiveDays).toBeGreaterThanOrEqual(14)
  })
})
