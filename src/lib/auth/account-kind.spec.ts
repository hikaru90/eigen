import { describe, expect, it } from 'vitest'
import { accountKindLabel, resolveAccountKindForNewUser } from './account-kind'

describe('account-kind', () => {
  it('marks reserved harness email domains at signup', () => {
    expect(resolveAccountKindForNewUser('eval-corpus-u1@local.eval')).toBe('harness')
    expect(resolveAccountKindForNewUser('e2e-1@test.eigen')).toBe('harness')
  })

  it('marks real signup emails as production', () => {
    expect(resolveAccountKindForNewUser('alexbueckner@googlemail.com')).toBe('production')
  })

  it('labels account kinds for admin UI', () => {
    expect(accountKindLabel('production')).toBe('Production')
    expect(accountKindLabel('harness')).toBe('Harness')
  })
})
