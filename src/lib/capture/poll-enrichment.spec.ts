import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCaptureResult } from '$lib/capture/capture-result-api'
import { pollUntilEnrichmentComplete } from './poll-enrichment'

vi.mock('$lib/capture/capture-result-api', () => ({
  fetchCaptureResult: vi.fn(),
}))

describe('pollUntilEnrichmentComplete', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('stops polling when enrichment completes', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchCaptureResult)
      .mockResolvedValueOnce({
        id: 't1',
        enrichmentComplete: false,
      } as Awaited<ReturnType<typeof fetchCaptureResult>>)
      .mockResolvedValueOnce({
        id: 't1',
        enrichmentComplete: true,
      } as Awaited<ReturnType<typeof fetchCaptureResult>>)

    const updates: boolean[] = []
    const cancel = pollUntilEnrichmentComplete({
      thoughtId: 't1',
      pollMs: 100,
      timeoutMs: 5000,
      onUpdate: (t) => updates.push(t.enrichmentComplete),
    })

    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(updates).toEqual([false, true])
    expect(fetchCaptureResult).toHaveBeenCalledTimes(2)
    cancel()
  })
})
