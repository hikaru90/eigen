import { afterEach, describe, expect, it } from 'vitest'
import { mapWithConcurrency, resolveEvalEntryConcurrency } from './concurrency'

describe('mapWithConcurrency', () => {
  it('preserves order and respects concurrency cap', async () => {
    const order: number[] = []
    let inFlight = 0
    let maxInFlight = 0

    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      order.push(n)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return n * 10
    })

    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(order.length).toBe(5)
  })
})

describe('resolveEvalEntryConcurrency', () => {
  const prev = process.env.EVAL_ENTRY_CONCURRENCY

  afterEach(() => {
    if (prev === undefined) delete process.env.EVAL_ENTRY_CONCURRENCY
    else process.env.EVAL_ENTRY_CONCURRENCY = prev
  })

  it('defaults to 8', () => {
    delete process.env.EVAL_ENTRY_CONCURRENCY
    expect(resolveEvalEntryConcurrency()).toBe(8)
  })
})
