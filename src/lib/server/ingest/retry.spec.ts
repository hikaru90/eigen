import { describe, expect, it } from 'vitest'
import { INGEST_MAX_RETRIES, isRetryExhaustedError, runIngestWithRetries } from './retry'

describe('runIngestWithRetries', () => {
  it('succeeds on first attempt without retries', async () => {
    let n = 0
    const v = await runIngestWithRetries(async () => {
      n++
      return 42
    })
    expect(v).toBe(42)
    expect(n).toBe(1)
  })

  it('retries exactly INGEST_MAX_RETRIES times after initial failure (AC-015)', async () => {
    let n = 0
    await expect(
      runIngestWithRetries(async () => {
        n++
        throw new Error('down')
      }),
    ).rejects.toThrow(/4 attempts/)
    expect(n).toBe(1 + INGEST_MAX_RETRIES)
  })

  it('returns RetryExhaustedError with lastCause (AC-016)', async () => {
    try {
      await runIngestWithRetries(async () => {
        throw new Error('upstream unavailable')
      })
      expect.fail('expected throw')
    } catch (e) {
      expect(isRetryExhaustedError(e)).toBe(true)
      if (isRetryExhaustedError(e)) {
        expect(e.attempts).toBe(4)
        expect((e.lastCause as Error).message).toBe('upstream unavailable')
      }
    }
  })

  it('succeeds on final retry attempt', async () => {
    let n = 0
    const v = await runIngestWithRetries(async () => {
      n++
      if (n < 4) throw new Error('transient')
      return 'ok'
    })
    expect(v).toBe('ok')
    expect(n).toBe(4)
  })
})
