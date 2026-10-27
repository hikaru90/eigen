import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPatternsMock } = vi.hoisted(() => ({ getPatternsMock: vi.fn() }))
vi.mock('$lib/server/patterns/patterns-service', () => ({ getPatternsForUser: getPatternsMock }))

import { InsufficientCreditsError } from '$lib/server/billing/wallet'
import { load } from './+page.server'

const event = (user: { id: string } | null = { id: 'u1' }) => ({ locals: { user } }) as never

describe('mesh/patterns load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('redirects anonymous users to /login', () => {
    expect(() => load(event(null))).toThrowError(expect.objectContaining({ status: 302 }))
  })

  it('streams a ready outcome', async () => {
    getPatternsMock.mockResolvedValue({ status: 'empty' })
    const out = (await load(event())) as { patterns: Promise<unknown> }
    await expect(out.patterns).resolves.toEqual({ kind: 'ready', result: { status: 'empty' } })
  })

  it('resolves (not rejects) to a typed failure on insufficient credits', async () => {
    getPatternsMock.mockRejectedValue(new InsufficientCreditsError({ phase: 'precheck' }))
    const out = (await load(event())) as { patterns: Promise<unknown> }
    await expect(out.patterns).resolves.toEqual({ kind: 'failed', reason: 'insufficient_credits' })
  })
})
