import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actions, load } from './+page.server'

const { getDbMock, authDbMock, setMock, checkCaptureAllowedMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  authDbMock: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })),
    })),
    update: vi.fn(() => ({ set: setMock })),
  },
  setMock: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  checkCaptureAllowedMock: vi.fn(),
}))
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/db/auth-db', () => ({ authDb: authDbMock }))
vi.mock('$lib/server/onboarding/capture-gate', () => ({
  checkCaptureAllowed: checkCaptureAllowedMock,
}))

describe('capture page server', () => {
  beforeEach(() => {
    setMock.mockClear()
    checkCaptureAllowedMock.mockClear()
  })

  it('redirects unauthenticated load', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 })
  })
  it('completeOnboarding requires auth', async () => {
    const result = await actions.completeOnboarding({ locals: { user: null } } as never)
    expect(result).toMatchObject({ status: 401 })
  })

  it('skipOnboarding requires auth', async () => {
    const result = await actions.skipOnboarding({ locals: { user: null } } as never)
    expect(result).toMatchObject({ status: 401 })
  })

  it('completeOnboarding fails with 400 when the capture gate blocks', async () => {
    checkCaptureAllowedMock.mockResolvedValueOnce({ allowed: false, reason: 'insufficient_credits' })
    const result = await actions.completeOnboarding({
      locals: { user: { id: 'u1' } },
    } as never)
    expect(result).toMatchObject({ status: 400 })
    expect(setMock).not.toHaveBeenCalled()
  })

  it('completeOnboarding marks onboarding complete when the gate allows', async () => {
    checkCaptureAllowedMock.mockResolvedValueOnce({ allowed: true })
    const result = await actions.completeOnboarding({
      locals: { user: { id: 'u1' } },
    } as never)
    expect(result).toEqual({ ok: true })
    expect(setMock).toHaveBeenCalledWith({ onboardingCompleted: true })
  })

  it('skipOnboarding marks onboarding complete without a credits gate', async () => {
    const result = await actions.skipOnboarding({ locals: { user: { id: 'u1' } } } as never)
    expect(result).toEqual({ ok: true })
    expect(setMock).toHaveBeenCalledWith({ onboardingCompleted: true })
    expect(checkCaptureAllowedMock).not.toHaveBeenCalled()
  })
})
