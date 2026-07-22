import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { readVapidConfigFromEnvMock } = vi.hoisted(() => ({
  readVapidConfigFromEnvMock: vi.fn(),
}))

vi.mock('$lib/server/push/vapid', () => ({
  readVapidConfigFromEnv: readVapidConfigFromEnvMock,
}))

describe('GET /api/push/vapid-public-key', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(
      GET({
        locals: { user: null },
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('returns the configured public key', async () => {
    readVapidConfigFromEnvMock.mockReturnValue({ publicKey: 'pk-test', privateKey: 'sk-test' })

    const res = await GET({
      locals: { user: { id: 'u1' } },
    } as never)

    expect(await res.json()).toEqual({ publicKey: 'pk-test' })
  })

  it('returns 503 when VAPID config is missing', async () => {
    readVapidConfigFromEnvMock.mockImplementation(() => {
      throw new Error('VAPID_PUBLIC_KEY is required')
    })

    await expect(
      GET({
        locals: { user: { id: 'u1' } },
      } as never),
    ).rejects.toMatchObject({ status: 503 })
  })
})
