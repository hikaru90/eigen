import { describe, expect, it, vi } from 'vitest'
import { actions, load } from './+page.server'

const { signUpEmailMock, isUseSendMailConfiguredMock } = vi.hoisted(() => ({
  signUpEmailMock: vi.fn(),
  isUseSendMailConfiguredMock: vi.fn(() => false),
}))
vi.mock('$lib/server/auth', () => ({ auth: { api: { signUpEmail: signUpEmailMock } } }))
vi.mock('$lib/server/auth-form-errors', () => ({
  getSafeErrorMessage: (e: unknown) => `safe: ${e}`,
}))
vi.mock('$lib/server/email/usesend', () => ({
  isUseSendMailConfigured: isUseSendMailConfiguredMock,
}))

describe('signup page server', () => {
  it('returns plan from valid query param', () => {
    const url = new URL('http://localhost/signup?plan=self-hosted')
    const data = load({ url, locals: { user: null } } as never)
    expect(data).toMatchObject({ plan: 'self-hosted' })
  })

  it('returns null plan when query param omitted', () => {
    const url = new URL('http://localhost/signup')
    const data = load({ url, locals: { user: null } } as never)
    expect(data).toMatchObject({ plan: null })
  })

  it('rejects invalid plan query param', () => {
    const url = new URL('http://localhost/signup?plan=invalid')
    expect(() => load({ url, locals: { user: null } } as never)).toThrow()
  })

  it('returns validation error for empty name', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: '',
        email: 'test@example.com',
        password: 'pass1234',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Name is required' } })
  })

  it('returns validation error for empty email', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: '',
        password: 'pass1234',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Invalid email address' } })
  })

  it('returns validation error for invalid email', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: 'invalid-email',
        password: 'pass1234',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Invalid email address' } })
  })

  it('returns validation error for short password', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: 'test@example.com',
        password: 'short',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({
      status: 400,
      data: { message: 'Password must be at least 8 characters' },
    })
  })

  it('returns validation error when terms are not accepted', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass1234',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({ status: 400 })
    expect(result.data.message).toMatch(/terms|AGB/i)
    expect(signUpEmailMock).not.toHaveBeenCalled()
  })

  it('returns auth error on sign-up failure', async () => {
    signUpEmailMock.mockRejectedValue(new Error('Email already in use'))
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass1234',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({ status: 400 })
    expect(result.data.message).toContain('safe:')
    expect(result.data.message).toContain('Email already in use')
  })

  it('returns safe error message on unknown error', async () => {
    signUpEmailMock.mockRejectedValue(new Error('Database error'))
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass1234',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({ status: 400 })
    expect(result.data.message).toContain('safe:')
    expect(result.data.message).toContain('Database error')
  })

  it('asks user to verify email when useSend is configured', async () => {
    isUseSendMailConfiguredMock.mockReturnValue(true)
    signUpEmailMock.mockResolvedValue({ user: { id: 'u1' }, token: null })
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass1234',
        acceptTerms: 'on',
      }),
    })
    const result = await actions.signUpEmail({ request } as never)
    expect(result).toMatchObject({
      checkEmail: true,
      message: 'Check your email for a verification link before signing in.',
    })
    expect(signUpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ callbackURL: '/capture' }),
      }),
    )
  })
})
