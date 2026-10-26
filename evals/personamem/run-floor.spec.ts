import { describe, expect, it } from 'vitest'
import { relevanceFloorFor } from '$lib/server/retrieval/relevance-floor'
import { COMPOSE_ANSWER_RELEVANCE_MIN } from '$lib/server/retrieval/rrf-scoring'
import { withRunRelevanceFloor } from './run-floor'

const TENANT = 'public-bench-personamem-v2-capture-gpt-4o-mini-val-p3'

describe('withRunRelevanceFloor', () => {
  it('product: no override, so a real-user constant applies (and a non-harness user is not refused)', async () => {
    await withRunRelevanceFloor('product', async () => {
      expect(relevanceFloorFor(TENANT)).toBe(COMPOSE_ANSWER_RELEVANCE_MIN)
      expect(relevanceFloorFor('some-real-user')).toBe(COMPOSE_ANSWER_RELEVANCE_MIN)
    })
  })

  it('a number: the override applies to the harness tenant for the whole callback, across awaits', async () => {
    const seen = await withRunRelevanceFloor(0.15, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return relevanceFloorFor(TENANT)
    })
    expect(seen).toBe(0.15)
    expect(relevanceFloorFor(TENANT)).toBe(COMPOSE_ANSWER_RELEVANCE_MIN)
  })

  it('a number: a non-harness tenant is refused', async () => {
    await expect(
      withRunRelevanceFloor(0.15, async () => relevanceFloorFor('some-real-user')),
    ).rejects.toThrow(/harness billing users/)
  })

  it('returns the callback result', async () => {
    await expect(withRunRelevanceFloor(0.1, async () => 7)).resolves.toBe(7)
    await expect(withRunRelevanceFloor('product', async () => 8)).resolves.toBe(8)
  })
})
