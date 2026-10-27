import type { PatternsResult } from './patterns-service'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InsufficientCreditsError } from '$lib/server/billing/wallet'
import { resolvePatternsOutcome } from './patterns-outcome'

const empty = { status: 'empty' } as unknown as PatternsResult

describe('resolvePatternsOutcome', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('passes a result through as ready', async () => {
    await expect(resolvePatternsOutcome(Promise.resolve(empty))).resolves.toEqual({
      kind: 'ready',
      result: empty,
    })
  })

  it('maps InsufficientCreditsError to insufficient_credits', async () => {
    const out = await resolvePatternsOutcome(
      Promise.reject(new InsufficientCreditsError({ phase: 'precheck' })),
    )
    expect(out).toEqual({ kind: 'failed', reason: 'insufficient_credits' })
  })

  it('uses an Error message', async () => {
    const out = await resolvePatternsOutcome(Promise.reject(new Error('gateway down')))
    expect(out).toEqual({ kind: 'failed', reason: 'error', message: 'gateway down' })
  })

  it('uses the string message of a plain object', async () => {
    const out = await resolvePatternsOutcome(Promise.reject({ message: 'plain boom' }))
    expect(out).toEqual({ kind: 'failed', reason: 'error', message: 'plain boom' })
  })

  it('stringifies other non-Error values, never [object Object]', async () => {
    expect(await resolvePatternsOutcome(Promise.reject('just text'))).toEqual({
      kind: 'failed',
      reason: 'error',
      message: 'just text',
    })
    const odd = await resolvePatternsOutcome(Promise.reject({ code: 7 }))
    expect(odd).toEqual({ kind: 'failed', reason: 'error', message: '{"code":7}' })
  })

  it('logs the original error server-side', async () => {
    const err = new Error('x')
    await resolvePatternsOutcome(Promise.reject(err))
    expect(console.error).toHaveBeenCalledWith('[patterns] load failed', err)
  })
})
