import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdminMock, adminGrantCreditsMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  adminGrantCreditsMock: vi.fn(),
}))

vi.mock('$lib/server/auth/require-admin', () => ({
  requireAdmin: requireAdminMock,
}))

vi.mock('$lib/server/billing/wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/billing/wallet')>()
  return {
    ...actual,
    adminGrantCredits: adminGrantCreditsMock,
  }
})

import { POST } from './+server'

function postEvent(body: unknown, userId = 'target-user') {
  return {
    locals: { user: { id: 'admin1', email: 'admin@example.com' } },
    params: { id: userId },
    request: {
      json: async () => body,
    },
  } as never
}

describe('POST /api/admin/users/[id]/credits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ id: 'admin1', email: 'admin@example.com' })
    adminGrantCreditsMock.mockResolvedValue({ availableCredits: 141 })
  })

  it('requires admin session', async () => {
    requireAdminMock.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    )
    await expect(POST(postEvent({ amountCredits: 41, reason: 'refund' }))).rejects.toMatchObject({
      status: 403,
    })
    expect(adminGrantCreditsMock).not.toHaveBeenCalled()
  })

  it('grants credits for a valid body', async () => {
    const res = await POST(
      postEvent({ amountCredits: 41, reason: 'Refund overnight overcharge' }),
    )
    const body = await res.json()

    expect(adminGrantCreditsMock).toHaveBeenCalledWith({
      userId: 'target-user',
      amountCredits: 41,
      reason: 'Refund overnight overcharge',
      adminUserId: 'admin1',
    })
    expect(body).toEqual({
      ok: true,
      availableCredits: 141,
      amountCredits: 41,
    })
  })

  it('returns 400 for invalid amount', async () => {
    const res = await POST(postEvent({ amountCredits: 0, reason: 'refund' }))
    expect(res.status).toBe(400)
    expect(adminGrantCreditsMock).not.toHaveBeenCalled()
  })

  it('returns 400 for missing reason', async () => {
    const res = await POST(postEvent({ amountCredits: 10, reason: '  ' }))
    expect(res.status).toBe(400)
    expect(adminGrantCreditsMock).not.toHaveBeenCalled()
  })
})
