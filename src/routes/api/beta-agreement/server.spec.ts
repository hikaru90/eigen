import { describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { acceptBetaAgreementMock } = vi.hoisted(() => ({
  acceptBetaAgreementMock: vi.fn(),
}))

vi.mock('$lib/server/beta-agreement', () => ({
  acceptBetaAgreement: acceptBetaAgreementMock,
}))

function event(overrides: { user?: { id: string } | null } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    request: new Request('http://localhost/api/beta-agreement', { method: 'POST' }),
  } as Parameters<typeof POST>[0]
}

describe('POST /api/beta-agreement', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(POST(event({ user: null }))).rejects.toMatchObject({ status: 401 })
    expect(acceptBetaAgreementMock).not.toHaveBeenCalled()
  })

  it('records acceptance for the current user and returns accepted: true', async () => {
    acceptBetaAgreementMock.mockResolvedValue(new Date('2026-09-02T10:00:00Z'))
    const res = await POST(event())
    expect(acceptBetaAgreementMock).toHaveBeenCalledWith('u1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: true })
  })

  it('returns 500 when the write fails', async () => {
    acceptBetaAgreementMock.mockRejectedValue(new Error('db unavailable'))
    await expect(POST(event())).rejects.toMatchObject({ status: 500 })
  })
})
