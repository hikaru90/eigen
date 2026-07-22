import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollGraphEnrichRefresh } from './poll-graph-enrich-refresh'

describe('pollGraphEnrichRefresh', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls onEnrichComplete when a pending thought leaves the queue', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thoughtIds: ['t1'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thoughtIds: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    const completes: number[] = []
    const cancel = pollGraphEnrichRefresh({
      pollMs: 100,
      onEnrichComplete: () => {
        completes.push(1)
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(completes).toEqual([])

    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(completes).toEqual([1])
    cancel()
  })
})
