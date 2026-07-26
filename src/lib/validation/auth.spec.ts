import { describe, expect, it } from 'vitest'
import { signInSchema, signUpSchema } from './auth'

describe('signUpSchema', () => {
  const valid = {
    name: 'Alex',
    email: 'alex@example.com',
    password: 'pass1234',
    acceptTerms: 'on' as const,
  }

  it('accepts a complete signup with terms accepted', () => {
    const result = signUpSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.acceptTerms).toBe(true)
    }
  })

  it('rejects when terms are not accepted', () => {
    const result = signUpSchema.safeParse({
      name: 'Alex',
      email: 'alex@example.com',
      password: 'pass1234',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.acceptTerms?.[0]).toMatch(/terms|AGB/i)
    }
  })

  it('rejects unchecked checkbox values', () => {
    expect(signUpSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...valid, acceptTerms: '' }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...valid, acceptTerms: 'off' }).success).toBe(false)
  })

  it('still requires name, email, and password', () => {
    expect(signUpSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false)
  })
})

describe('signInSchema', () => {
  it('does not require terms acceptance', () => {
    expect(signInSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true)
  })
})
