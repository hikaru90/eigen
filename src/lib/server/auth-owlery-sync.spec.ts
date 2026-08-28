import { beforeEach, describe, expect, it, vi } from 'vitest'

const createOwleryContactMock = vi.fn()
const isOwleryConfiguredMock = vi.fn()

vi.mock('$lib/server/env/private-env', () => ({
  env: {},
}))

vi.mock('$lib/server/owlery/contacts', () => ({
  isOwleryConfigured: (...args: unknown[]) => isOwleryConfiguredMock(...args),
  createOwleryContact: (...args: unknown[]) => createOwleryContactMock(...args),
}))

import { syncOwleryContactForVerifiedUser } from './auth-owlery-sync'

describe('syncOwleryContactForVerifiedUser', () => {
  beforeEach(() => {
    createOwleryContactMock.mockReset()
    isOwleryConfiguredMock.mockReset()
    createOwleryContactMock.mockResolvedValue({ contactId: 'ct_1' })
  })

  it('skips when Owlery is not configured', async () => {
    isOwleryConfiguredMock.mockReturnValue(false)

    await syncOwleryContactForVerifiedUser({
      id: 'u1',
      email: 'a@b.com',
      emailVerified: true,
      firstName: 'Ada',
    })

    expect(createOwleryContactMock).not.toHaveBeenCalled()
  })

  it('skips when email is not verified', async () => {
    isOwleryConfiguredMock.mockReturnValue(true)

    await syncOwleryContactForVerifiedUser({
      id: 'u1',
      email: 'a@b.com',
      emailVerified: false,
      firstName: 'Ada',
    })

    expect(createOwleryContactMock).not.toHaveBeenCalled()
  })

  it('creates a contact when configured and email is verified', async () => {
    isOwleryConfiguredMock.mockReturnValue(true)

    await syncOwleryContactForVerifiedUser({
      id: 'u1',
      email: 'ada@example.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
    })

    expect(createOwleryContactMock).toHaveBeenCalledWith(
      {},
      {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    )
  })

  it('logs failures without throwing', async () => {
    isOwleryConfiguredMock.mockReturnValue(true)
    createOwleryContactMock.mockRejectedValue(new Error('owlery down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await syncOwleryContactForVerifiedUser({
      id: 'u2',
      email: 'a@b.com',
      emailVerified: true,
      firstName: 'Ada',
    })

    expect(errSpy).toHaveBeenCalledWith(
      '[auth] owlery contact sync failed',
      expect.objectContaining({ userId: 'u2', error: 'owlery down' }),
    )
    errSpy.mockRestore()
  })
})
