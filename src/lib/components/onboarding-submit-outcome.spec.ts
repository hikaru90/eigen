import { describe, expect, it } from 'vitest'
import { resolveSubmitOutcome } from './onboarding-submit-outcome'

describe('resolveSubmitOutcome', () => {
  it('returns success unchanged', () => {
    expect(resolveSubmitOutcome({ type: 'success' })).toEqual({ kind: 'success' })
  })

  it('marks a 400 failure as credits-gated', () => {
    expect(resolveSubmitOutcome({ type: 'failure', status: 400 })).toEqual({
      kind: 'credits_gate',
    })
  })

  it('marks a 401 failure as auth', () => {
    expect(resolveSubmitOutcome({ type: 'failure', status: 401 })).toEqual({ kind: 'auth' })
  })

  it('marks any other failure as generic', () => {
    expect(resolveSubmitOutcome({ type: 'failure', status: 500 })).toEqual({ kind: 'generic' })
    expect(resolveSubmitOutcome({ type: 'failure', status: undefined })).toEqual({
      kind: 'generic',
    })
  })

  it('marks redirect and other outcome types as generic', () => {
    expect(resolveSubmitOutcome({ type: 'redirect', status: 302, location: '/login' })).toEqual({
      kind: 'generic',
    })
  })

  it('marks invalid data as generic', () => {
    expect(resolveSubmitOutcome(null)).toEqual({ kind: 'generic' })
    expect(resolveSubmitOutcome({ type: 123 as unknown as string })).toEqual({
      kind: 'generic',
    })
  })
})
