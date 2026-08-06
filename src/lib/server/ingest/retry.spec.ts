import { describe, expect, it } from 'vitest'
import { LlmHttpError } from '$lib/server/llm/errors'
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

  it('does not retry gateway 402 billing failures — fatal immediately', async () => {
    let n = 0
    await expect(
      runIngestWithRetries(async () => {
        n++
        throw new LlmHttpError(402, 'insufficient balance')
      }),
    ).rejects.toThrow(/Fatal ingest error \(no retry\)/)
    expect(n).toBe(1)
  })

  it('retries non-402 gateway failures up to the budget', async () => {
    let n = 0
    await expect(
      runIngestWithRetries(async () => {
        n++
        throw new LlmHttpError(500, 'internal')
      }),
    ).rejects.toThrow(/4 attempts/)
    expect(n).toBe(1 + INGEST_MAX_RETRIES)
  })

  it('treats InsufficientCreditsError-named errors as fatal without retries', async () => {
    let n = 0
    const credits = new Error('insufficient credits')
    credits.name = 'InsufficientCreditsError'
    await expect(
      runIngestWithRetries(async () => {
        n++
        throw credits
      }),
    ).rejects.toThrow(/Fatal ingest error \(no retry\)/)
    expect(n).toBe(1)
  })

  it('treats InvalidMemoryTypeError as fatal without outer retries', async () => {
    let n = 0
    const invalid = new Error('extractThoughtMetadata: invalid memoryType "task"')
    invalid.name = 'InvalidMemoryTypeError'
    await expect(
      runIngestWithRetries(async () => {
        n++
        throw invalid
      }),
    ).rejects.toThrow(/Fatal ingest error \(no retry\)/)
    expect(n).toBe(1)
  })
})
