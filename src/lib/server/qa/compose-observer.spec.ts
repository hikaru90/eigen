import type { ComposedAnswer } from './compose-answer'
import { describe, expect, it } from 'vitest'
import { observeBelowFloor, observeComposedAnswer, withComposeObserver } from './compose-observer'

const HARNESS_USER = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
const composed = (tag: string) => ({ tag }) as unknown as ComposedAnswer

describe('compose observer', () => {
  it('collects every composed answer observed inside the callback, in order', async () => {
    const { result, observed } = await withComposeObserver(HARNESS_USER, async () => {
      observeComposedAnswer(HARNESS_USER, composed('a'))
      await new Promise((resolve) => setTimeout(resolve, 1))
      observeComposedAnswer(HARNESS_USER, composed('b'))
      return 7
    })
    expect(result).toBe(7)
    expect(observed.map((c) => (c as unknown as { tag: string }).tag)).toEqual(['a', 'b'])
  })

  it('observing outside an observer is a no-op', () => {
    expect(() => observeComposedAnswer(HARNESS_USER, composed('a'))).not.toThrow()
  })

  it('is refused for a non-harness user', async () => {
    await expect(withComposeObserver('some-real-user', async () => 1)).rejects.toThrow(
      /harness billing users/,
    )
  })

  it('refuses an observation made for a non-harness user', async () => {
    await expect(
      withComposeObserver(HARNESS_USER, async () =>
        observeComposedAnswer('some-real-user', composed('a')),
      ),
    ).rejects.toThrow(/harness billing users/)
  })

  it('collects below-floor scores of every compose call, next to the composed answers', async () => {
    const { observed, belowFloor } = await withComposeObserver(HARNESS_USER, async () => {
      observeBelowFloor(HARNESS_USER, { thoughts: 0.19 })
      observeComposedAnswer(HARNESS_USER, composed('a'))
      observeBelowFloor(HARNESS_USER, { thoughts: null })
    })
    expect(observed).toHaveLength(1)
    expect(belowFloor).toEqual([{ thoughts: 0.19 }, { thoughts: null }])
  })

  it('observing below-floor scores outside an observer is a no-op, even for a real user', () => {
    expect(() =>
      observeBelowFloor('some-real-user', { thoughts: 0.1 }),
    ).not.toThrow()
  })

  it('refuses a below-floor observation made for a non-harness user', async () => {
    await expect(
      withComposeObserver(HARNESS_USER, async () =>
        observeBelowFloor('some-real-user', { thoughts: 0.1 }),
      ),
    ).rejects.toThrow(/harness billing users/)
  })
})
