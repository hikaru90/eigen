import { describe, expect, it } from 'vitest'
import { currentEvalClock, evalClockFor, withEvalClock } from './eval-clock'

const DAY_ONE = new Date('2025-03-01T09:00:00.000Z')
const DAY_TWO = new Date('2025-03-02T09:00:00.000Z')

describe('eval clock context', () => {
  it('is unset outside withEvalClock', () => {
    expect(currentEvalClock()).toBeUndefined()
  })

  it('exposes the date inside the callback, across awaits, and returns the result', async () => {
    const result = await withEvalClock(DAY_ONE, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      expect(currentEvalClock()?.toISOString()).toBe(DAY_ONE.toISOString())
      return 42
    })
    expect(result).toBe(42)
    expect(currentEvalClock()).toBeUndefined()
  })

  it('nested contexts shadow and restore', async () => {
    await withEvalClock(DAY_ONE, async () => {
      await withEvalClock(DAY_TWO, async () => {
        expect(currentEvalClock()?.toISOString()).toBe(DAY_TWO.toISOString())
      })
      expect(currentEvalClock()?.toISOString()).toBe(DAY_ONE.toISOString())
    })
  })

  it('parallel contexts stay isolated', async () => {
    const seen = await Promise.all(
      [DAY_ONE, DAY_TWO].map((date) =>
        withEvalClock(date, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          return currentEvalClock()?.toISOString()
        }),
      ),
    )
    expect(seen).toEqual([DAY_ONE.toISOString(), DAY_TWO.toISOString()])
  })

  it('callers cannot mutate the stored clock', async () => {
    await withEvalClock(DAY_ONE, async () => {
      currentEvalClock()?.setUTCFullYear(1999)
      expect(currentEvalClock()?.toISOString()).toBe(DAY_ONE.toISOString())
    })
  })

  it('rejects an invalid date without running the callback', async () => {
    let ran = false
    await expect(
      withEvalClock(new Date('not a date'), async () => {
        ran = true
      }),
    ).rejects.toThrow(/Invalid eval clock/)
    expect(ran).toBe(false)
  })
})

describe('evalClockFor', () => {
  it('is undefined for every user when no clock is set', () => {
    expect(evalClockFor('user-1')).toBeUndefined()
    expect(evalClockFor('public-bench-runner')).toBeUndefined()
  })

  it('returns the clock for harness billing tenants', async () => {
    const seen = await withEvalClock(DAY_ONE, async () =>
      evalClockFor('public-bench-personamem-v2-ask-gpt-4o-mini-p78'),
    )
    expect(seen?.toISOString()).toBe(DAY_ONE.toISOString())
  })

  it('throws for a non-harness user and never returns the clock', async () => {
    await expect(
      withEvalClock(DAY_ONE, async () => evalClockFor('user-1')),
    ).rejects.toThrow(/harness/i)
  })
})
