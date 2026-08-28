import { describe, expect, it, vi } from 'vitest'
import { actions, load } from './+page.server'

const { requestPasswordResetMock, isOwleryMailConfiguredMock } = vi.hoisted(() => ({
  requestPasswordResetMock: vi.fn(),
  isOwleryMailConfiguredMock: vi.fn(() => true),
}))
vi.mock('$lib/server/auth', () => ({
  auth: { api: { requestPasswordReset: requestPasswordResetMock } },
}))
vi.mock('$lib/server/auth-form-errors', () => ({
  getSafeErrorMessage: (e: unknown, fallback = 'fallback') =>
    e instanceof Error ? e.message || fallback : fallback,
}))
vi.mock('$lib/server/owlery/mail', () => ({
  isOwleryMailConfigured: isOwleryMailConfiguredMock,
}))

describe('forgot-password page server', () => {
  it('redirects authenticated users to capture', () => {
    expect(() => load({ locals: { user: { id: 'u1' } } } as never)).toThrow()
  })

  it('exposes whether mail is configured', () => {
    isOwleryMailConfiguredMock.mockReturnValue(true)
    expect(load({ locals: { user: null } } as never)).toMatchObject({ mailConfigured: true })
  })

  it('returns validation error for empty email', async () => {
    const request = new Request('http://localhost/forgot-password', {
      method: 'POST',
      body: new URLSearchParams({ email: '' }),
    })
    const result = await actions.requestReset({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Invalid email address' } })
    expect(requestPasswordResetMock).not.toHaveBeenCalled()
  })

  it('fails when mail is not configured', async () => {
    isOwleryMailConfiguredMock.mockReturnValue(false)
    const request = new Request('http://localhost/forgot-password', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com' }),
    })
    const result = await actions.requestReset({ request } as never)
    expect(result).toMatchObject({ status: 503 })
    expect(result.data.message).toMatch(/email is not configured/i)
    expect(requestPasswordResetMock).not.toHaveBeenCalled()
  })

  it('requests a reset with redirect to /reset-password', async () => {
    isOwleryMailConfiguredMock.mockReturnValue(true)
    requestPasswordResetMock.mockResolvedValue({ status: true })
    const request = new Request('http://localhost/forgot-password', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com' }),
    })
    const result = await actions.requestReset({ request } as never)
    expect(result).toMatchObject({
      checkEmail: true,
      message: expect.stringMatching(/check your email/i),
    })
    expect(requestPasswordResetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: 'test@example.com',
          redirectTo: '/reset-password',
        }),
      }),
    )
  })

  it('returns safe error when Better Auth rejects the request', async () => {
    isOwleryMailConfiguredMock.mockReturnValue(true)
    requestPasswordResetMock.mockRejectedValue(new Error('Reset password isn\'t enabled'))
    const request = new Request('http://localhost/forgot-password', {
      method: 'POST',
      body: new URLSearchParams({ email: 'test@example.com' }),
    })
    const result = await actions.requestReset({ request } as never)
    expect(result).toMatchObject({ status: 400 })
    expect(result.data.message).toContain("isn't enabled")
  })
})
