import { describe, expect, it, vi } from 'vitest'
import { actions, load } from './+page.server'

const { resetPasswordMock } = vi.hoisted(() => ({
  resetPasswordMock: vi.fn(),
}))
vi.mock('$lib/server/auth', () => ({
  auth: { api: { resetPassword: resetPasswordMock } },
}))
vi.mock('$lib/server/auth-form-errors', () => ({
  getSafeErrorMessage: (e: unknown, fallback = 'fallback') =>
    e instanceof Error ? e.message || fallback : fallback,
}))

describe('reset-password page server', () => {
  it('redirects authenticated users to capture', () => {
    expect(() =>
      load({
        locals: { user: { id: 'u1' } },
        url: new URL('http://localhost/reset-password?token=abc'),
      } as never),
    ).toThrow()
  })

  it('reads token from query and reports invalid token errors', () => {
    const data = load({
      locals: { user: null },
      url: new URL('http://localhost/reset-password?error=INVALID_TOKEN'),
    } as never)
    expect(data).toMatchObject({
      token: null,
      error: 'INVALID_TOKEN',
    })
  })

  it('exposes a valid token from the query string', () => {
    const data = load({
      locals: { user: null },
      url: new URL('http://localhost/reset-password?token=reset-tok-1'),
    } as never)
    expect(data).toMatchObject({ token: 'reset-tok-1', error: null })
  })

  it('returns validation error for short password', async () => {
    const request = new Request('http://localhost/reset-password', {
      method: 'POST',
      body: new URLSearchParams({ password: 'short', token: 'tok' }),
    })
    const result = await actions.resetPassword({ request } as never)
    expect(result).toMatchObject({
      status: 400,
      data: { message: 'Password must be at least 8 characters' },
    })
    expect(resetPasswordMock).not.toHaveBeenCalled()
  })

  it('returns validation error when token is missing', async () => {
    const request = new Request('http://localhost/reset-password', {
      method: 'POST',
      body: new URLSearchParams({ password: 'pass1234', token: '' }),
    })
    const result = await actions.resetPassword({ request } as never)
    expect(result).toMatchObject({ status: 400, data: { message: 'Reset token is required' } })
  })

  it('resets the password and signals success', async () => {
    resetPasswordMock.mockResolvedValue({ status: true })
    const request = new Request('http://localhost/reset-password', {
      method: 'POST',
      body: new URLSearchParams({ password: 'pass1234', token: 'reset-tok-1' }),
    })
    const result = await actions.resetPassword({ request } as never)
    expect(result).toMatchObject({
      success: true,
      message: expect.stringMatching(/password has been reset/i),
    })
    expect(resetPasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          newPassword: 'pass1234',
          token: 'reset-tok-1',
        }),
      }),
    )
  })

  it('returns safe error when Better Auth rejects the token', async () => {
    resetPasswordMock.mockRejectedValue(new Error('Invalid token'))
    const request = new Request('http://localhost/reset-password', {
      method: 'POST',
      body: new URLSearchParams({ password: 'pass1234', token: 'bad' }),
    })
    const result = await actions.resetPassword({ request } as never)
    expect(result).toMatchObject({ status: 400 })
    expect(result.data.message).toContain('Invalid token')
  })
})
