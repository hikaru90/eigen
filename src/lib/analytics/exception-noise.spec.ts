import { describe, expect, it } from 'vitest'
import { isNoiseException } from './exception-noise'

describe('isNoiseException', () => {
  it('drops ResizeObserver browser safety noise', () => {
    expect(
      isNoiseException(new Error('ResizeObserver loop completed with undelivered notifications.')),
    ).toBe(true)
    expect(isNoiseException(new Error('ResizeObserver loop limit exceeded'))).toBe(true)
  })

  it('drops Vite HMR / module-runner disconnects from long-running SSR work', () => {
    expect(isNoiseException(new Error('Vite module runner has been closed.'))).toBe(true)
    expect(
      isNoiseException(new Error('transport was disconnected, cannot call "fetchModule"')),
    ).toBe(true)
  })

  it('drops Android WebView postMessage teardown and generic network fetch failures', () => {
    expect(isNoiseException(new Error('Error invoking postMessage: Java object is gone'))).toBe(
      true,
    )
    expect(isNoiseException(new Error('Failed to fetch'))).toBe(true)
  })

  it('drops stale marketing/motion stacks that no longer exist in this repo', () => {
    const err = new Error('IDLE_DRIFT_SPEED is not defined')
    err.stack = `ReferenceError: IDLE_DRIFT_SPEED is not defined
    at src/lib/components/marketing/embedding-map-3d-preview.svelte:12:3`
    expect(isNoiseException(err)).toBe(true)
  })

  it('keeps real application errors', () => {
    expect(
      isNoiseException(
        new Error('getDb() was called outside an active request (missing app DB context)'),
      ),
    ).toBe(false)
    expect(isNoiseException(new Error('Enrichment step(s) failed'))).toBe(false)
  })
})
