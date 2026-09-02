import { describe, expect, it } from 'vitest'
import { shouldShowBetaModal } from './beta-agreement'

describe('shouldShowBetaModal', () => {
  it('shows for a logged-in new user on a non-auth path', () => {
    expect(shouldShowBetaModal({ isLoggedIn: true, accepted: false, isAuthPath: false })).toBe(true)
  })

  it('never shows after acceptance', () => {
    expect(shouldShowBetaModal({ isLoggedIn: true, accepted: true, isAuthPath: false })).toBe(false)
  })

  it('never shows for anonymous visitors', () => {
    expect(shouldShowBetaModal({ isLoggedIn: false, accepted: false, isAuthPath: false })).toBe(
      false,
    )
  })

  it('never shows on auth paths (login/signup stay usable)', () => {
    expect(shouldShowBetaModal({ isLoggedIn: true, accepted: false, isAuthPath: true })).toBe(false)
  })
})
