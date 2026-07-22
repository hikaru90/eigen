import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdminMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
}))

vi.mock('$lib/server/auth/require-admin', () => ({
  requireAdmin: requireAdminMock,
}))

import { load } from './+layout.server'

describe('admin layout server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects unauthenticated users via requireAdmin', async () => {
    requireAdminMock.mockRejectedValueOnce(
      Object.assign(new Error('Redirect'), { status: 302, location: '/login' }),
    )

    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
    expect(requireAdminMock).toHaveBeenCalledWith(null)
  })

  it('returns empty layout data when admin is allowed', async () => {
    const user = { id: 'admin1', email: 'admin@example.com' }
    requireAdminMock.mockResolvedValueOnce(user)

    const result = await load({ locals: { user } } as never)

    expect(result).toEqual({})
    expect(requireAdminMock).toHaveBeenCalledWith(user)
  })
})
