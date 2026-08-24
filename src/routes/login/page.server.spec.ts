import { describe, expect, it, vi } from 'vitest'
import { actions, load } from './+page.server'

const { signInEmailMock, sendVerificationEmailMock, isUseSendMailConfiguredMock } = vi.hoisted(
  () => ({
    signInEmailMock: vi.fn(),
    sendVerificationEmailMock: vi.fn(),
    isUseSendMailConfiguredMock: vi.fn(() => false),
  }),
)
vi.mock('$lib/server/auth', () => ({
  auth: {
    api: {
      signInEmail: signInEmailMock,
      sendVerificationEmail: sendVerificationEmailMock,
    },
  },
}))
vi.mock('$lib/server/auth-form-errors', () => ({
  getSafeErrorMessage: (e: unknown, _fallback = 'fallback') => {
    if (e instanceof Error && e.message === 'Email not verified') return e.message
    return `safe: ${e}`
  },
}))
vi.mock('$lib/server/email/usesend', () => ({
  isUseSendMailConfigured: isUseSendMailConfiguredMock,
}))

describe('login page server', () => {
  it('exposes mailConfigured for forgot-password / resend UI', () => {
    isUseSendMailConfiguredMock.mockReturnValue(true)
    const data = load({
      locals: { user: null },
      url: new URL('http://localhost/login'),
    } as never)
    expect(data).toMatchObject({ mailConfigured: true })
  })

  it('returns validation error for empty email', async () => {
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: '', password: 'pass123' }),
    })
    const result = await actions.signInEmail({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Invalid email address' } })
  })

  it('returns validation error for empty password', async () => {
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com', password: '' }),
    })
    const result = await actions.signInEmail({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Password is required' } })
  })

  it('returns auth error on sign-in failure', async () => {
    signInEmailMock.mockRejectedValue(new Error('Invalid credentials'))
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com', password: 'wrong' }),
    })
    const result = await actions.signInEmail({ request } as never)
    expect(result).toMatchObject({ status: 401 })
    expect(result.data.message).toContain('safe:')
    expect(result.data.message).toContain('Invalid credentials')
  })

  it('returns safe error message on unknown error', async () => {
    signInEmailMock.mockRejectedValue(new Error('Network error'))
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com', password: 'pass123' }),
    })
    const result = await actions.signInEmail({ request } as never)
    expect(result).toMatchObject({ status: 401 })
    expect(result.data.message).toContain('safe:')
    expect(result.data.message).toContain('Network error')
  })

  it('returns verification guidance when email is not verified', async () => {
    signInEmailMock.mockRejectedValue(new Error('Email not verified'))
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com', password: 'pass1234' }),
    })
    const result = await actions.signInEmail({ request } as never)
    expect(result).toMatchObject({ status: 403 })
    expect(result.data.message).toContain('Email not verified')
    expect(result.data.emailUnverified).toBe(true)
    expect(result.data.email).toBe('test@example.com')
  })

  it('resends verification email when mail is configured', async () => {
    isUseSendMailConfiguredMock.mockReturnValue(true)
    sendVerificationEmailMock.mockResolvedValue({ status: true })
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com' }),
    })
    const result = await actions.resendVerification({ request } as never)
    expect(result).toMatchObject({
      verificationSent: true,
      message: expect.stringMatching(/verification link/i),
    })
    expect(sendVerificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: 'test@example.com',
          callbackURL: '/capture',
        }),
      }),
    )
  })

  it('rejects resend when mail is not configured', async () => {
    isUseSendMailConfiguredMock.mockReturnValue(false)
    sendVerificationEmailMock.mockClear()
    const request = new Request('http://localhost/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com' }),
    })
    const result = await actions.resendVerification({ request } as never)
    expect(result).toMatchObject({ status: 503 })
    expect(sendVerificationEmailMock).not.toHaveBeenCalled()
  })
})
