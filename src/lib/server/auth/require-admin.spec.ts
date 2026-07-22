import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isUserAdminMock } = vi.hoisted(() => ({
  isUserAdminMock: vi.fn(),
}))

vi.mock('$lib/server/auth/user-role', () => ({
  isUserAdmin: isUserAdminMock,
}))

import { requireAdmin } from './require-admin'

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to login when user is missing', async () => {
    await expect(requireAdmin(undefined)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns 403 when user is not admin', async () => {
    isUserAdminMock.mockResolvedValue(false)
    await expect(requireAdmin({ id: 'u1' } as App.Locals['user'])).rejects.toMatchObject({
      status: 403,
    })
  })

  it('returns user when admin', async () => {
    isUserAdminMock.mockResolvedValue(true)
    const user = { id: 'u1', email: 'ops@example.com' } as NonNullable<App.Locals['user']>
    await expect(requireAdmin(user)).resolves.toBe(user)
  })
})
