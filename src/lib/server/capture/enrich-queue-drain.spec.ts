import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCaptureEnrichConcurrency } from '../orchestration-concurrency'
import { drainCaptureEnrichQueue } from './enrich-queue-drain'

describe('resolveCaptureEnrichConcurrency', () => {
  const prev = process.env.CAPTURE_ENRICH_CONCURRENCY

  afterEach(() => {
    if (prev === undefined) delete process.env.CAPTURE_ENRICH_CONCURRENCY
    else process.env.CAPTURE_ENRICH_CONCURRENCY = prev
  })

  it('defaults to 8 when env is unset', () => {
    delete process.env.CAPTURE_ENRICH_CONCURRENCY
    delete process.env.LLM_ORCHESTRATION_CONCURRENCY
    expect(resolveCaptureEnrichConcurrency()).toBe(8)
  })
})

describe('drainCaptureEnrichQueue', () => {
  it('drains sequentially when concurrency is 1', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValueOnce({ id: 't2' })
      .mockResolvedValueOnce(null)
    const enrich = vi.fn().mockResolvedValue(undefined)
    const countPending = vi.fn().mockResolvedValue(0)

    const processed = await drainCaptureEnrichQueue('user-1', {
      concurrency: 1,
      claim,
      enrich,
      countPending,
      idlePollMs: 1,
      idleRoundsBeforeExit: 1,
    })

    expect(processed).toBe(2)
    expect(enrich).toHaveBeenCalledTimes(2)
  })

  it('respects concurrency cap across workers', async () => {
    const queue = ['t1', 't2', 't3', 't4']
    const claim = vi.fn().mockImplementation(async () => {
      const id = queue.shift()
      return id ? { id } : null
    })

    let inFlight = 0
    let maxInFlight = 0
    const enrich = vi.fn().mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight -= 1
    })
    const countPending = vi.fn().mockResolvedValue(0)

    const processed = await drainCaptureEnrichQueue('user-1', {
      concurrency: 2,
      claim,
      enrich,
      countPending,
      idlePollMs: 1,
      idleRoundsBeforeExit: 1,
    })

    expect(processed).toBe(4)
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('picks up rows that arrive while another enrich is in flight', async () => {
    const queue = ['t1']
    let releaseFirst: (() => void) | null = null
    const claim = vi.fn().mockImplementation(async () => {
      const id = queue.shift()
      return id ? { id } : null
    })

    let inFlight = 0
    let maxInFlight = 0
    const enrich = vi.fn().mockImplementation(async (_userId: string, thoughtId: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (thoughtId === 't1') {
        queue.push('t2', 't3')
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      } else {
        await new Promise((r) => setTimeout(r, 5))
      }
      inFlight -= 1
    })

    const countPending = vi.fn().mockImplementation(async () => queue.length)

    const drain = drainCaptureEnrichQueue('user-1', {
      concurrency: 3,
      claim,
      enrich,
      countPending,
      idlePollMs: 5,
      idleRoundsBeforeExit: 2,
    })

    await new Promise((r) => setTimeout(r, 20))
    releaseFirst?.()
    const processed = await drain

    expect(processed).toBe(3)
    expect(maxInFlight).toBeGreaterThan(1)
  })
})
