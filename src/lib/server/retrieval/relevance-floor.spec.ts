import { describe, expect, it } from 'vitest'
import { relevanceFloorFor, withEvalRelevanceFloor } from './relevance-floor'
import { COMPOSE_ANSWER_RELEVANCE_MIN } from './rrf-scoring'

const HARNESS_USER = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'

describe('relevanceFloorFor', () => {
  it('is the product constant when no override is set, for any user', () => {
    expect(relevanceFloorFor(HARNESS_USER)).toBe(COMPOSE_ANSWER_RELEVANCE_MIN)
    expect(relevanceFloorFor('some-real-user')).toBe(COMPOSE_ANSWER_RELEVANCE_MIN)
  })

  it('returns the override inside withEvalRelevanceFloor, across awaits, and restores after', async () => {
    const result = await withEvalRelevanceFloor(0.1, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      expect(relevanceFloorFor(HARNESS_USER)).toBe(0.1)
      return 'done'
    })
    expect(result).toBe('done')
    expect(relevanceFloorFor(HARNESS_USER)).toBe(COMPOSE_ANSWER_RELEVANCE_MIN)
  })

  it('nested overrides shadow and restore', async () => {
    await withEvalRelevanceFloor(0.15, async () => {
      await withEvalRelevanceFloor(0, async () => {
        expect(relevanceFloorFor(HARNESS_USER)).toBe(0)
      })
      expect(relevanceFloorFor(HARNESS_USER)).toBe(0.15)
    })
  })

  it('parallel overrides stay isolated', async () => {
    const seen = await Promise.all(
      [0.1, 0.15].map((floor) =>
        withEvalRelevanceFloor(floor, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2))
          return relevanceFloorFor(HARNESS_USER)
        }),
      ),
    )
    expect(seen).toEqual([0.1, 0.15])
  })

  it('throws for a non-harness user while an override is active', async () => {
    await expect(
      withEvalRelevanceFloor(0.1, async () => relevanceFloorFor('some-real-user')),
    ).rejects.toThrow(/harness billing users/)
  })

  it('accepts the bounds 0 and 1 and rejects anything outside [0, 1] or not a number', async () => {
    await expect(
      withEvalRelevanceFloor(0, async () => relevanceFloorFor(HARNESS_USER)),
    ).resolves.toBe(0)
    await expect(
      withEvalRelevanceFloor(1, async () => relevanceFloorFor(HARNESS_USER)),
    ).resolves.toBe(1)
    for (const bad of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(withEvalRelevanceFloor(bad, async () => 1)).rejects.toThrow(/\[0, 1\]/)
    }
  })
})
