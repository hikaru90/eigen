import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, decryptMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: decryptMock }))

import { loadBreakdownTask } from './now-breakdown'

const CARD_ID = '3f1c2a54-7d0e-4b8a-9c11-2e5f6a7b8c9d'

function dbReturning(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const chain: Record<string, unknown> = { from: () => chain, where: () => chain, limit }
  getDbMock.mockReturnValue({ select: () => chain })
  return { limit }
}

describe('loadBreakdownTask (NOW-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    decryptMock.mockResolvedValue(
      JSON.stringify({ text: 'Send the form to the accountant.', why: 'Due soon.' }),
    )
  })

  it('returns the decrypted task text of the user\'s own card', async () => {
    dbReturning([{ targetThoughtId: 'th-1', payloadEncrypted: 'enc:1' }])

    await expect(loadBreakdownTask('u1', CARD_ID)).resolves.toBe('Send the form to the accountant.')
    expect(decryptMock).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'now_card',
      column: 'payload',
      ciphertext: 'enc:1',
    })
  })

  it('is null for a card that does not exist or belongs to someone else (the query is by user)', async () => {
    dbReturning([])
    await expect(loadBreakdownTask('u1', CARD_ID)).resolves.toBeNull()
    expect(decryptMock).not.toHaveBeenCalled()
  })

  it('is null for a card with no thought target (a project card has nothing to break down)', async () => {
    dbReturning([{ targetThoughtId: null, payloadEncrypted: 'enc:1' }])
    await expect(loadBreakdownTask('u1', CARD_ID)).resolves.toBeNull()
    expect(decryptMock).not.toHaveBeenCalled()
  })

  it('is null for an id that is not a uuid, without touching the database', async () => {
    await expect(loadBreakdownTask('u1', 'not-a-uuid')).resolves.toBeNull()
    expect(getDbMock).not.toHaveBeenCalled()
  })
})
