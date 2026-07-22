import { describe, expect, it } from 'vitest'
import { parseSignupPlanParam, signupPlanSubtitle } from '$lib/auth/signup-plan'

describe('signup-plan', () => {
  it('parseSignupPlanParam accepts valid plans and rejects unknown', () => {
    expect(parseSignupPlanParam(null)).toBeNull()
    expect(parseSignupPlanParam('managed')).toBe('managed')
    expect(parseSignupPlanParam('self-hosted')).toBe('self-hosted')
    expect(parseSignupPlanParam('enterprise')).toBeNull()
    expect(parseSignupPlanParam('')).toBeNull()
  })

  it('signupPlanSubtitle describes deployment context', () => {
    expect(signupPlanSubtitle('managed')).toContain('managed hosting')
    expect(signupPlanSubtitle('self-hosted')).toContain('self-hosted')
  })
})
