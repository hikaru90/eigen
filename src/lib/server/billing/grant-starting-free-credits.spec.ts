import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STARTING_FREE_CREDITS } from './credits'

const { withDbUserMock } = vi.hoisted(() => ({
  withDbUserMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

function makeGrantMocks(options: {
  accountKind?: 'production' | 'harness'
  existingBonus?: boolean
  walletCredits?: number
}) {
  const ledgerValues = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  const insertOnConflict = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoNothing: insertOnConflict }),
  })

  const wallet = {
    userId: 'u1',
    availableCredits: options.walletCredits ?? 0,
    reservedCredits: 0,
    pendingBillingMicroUsd: 0,
    currency: 'USD',
    updatedAt: new Date(),
  }

  const userSelectLimit = vi
    .fn()
    .mockResolvedValue([{ accountKind: options.accountKind ?? 'production' }])
  const bonusSelectLimit = vi
    .fn()
    .mockResolvedValue(options.existingBonus ? [{ id: 'bonus-1' }] : [])
  const walletSelectFor = vi.fn().mockResolvedValue([wallet])
  const walletSelectLimit = vi
    .fn()
    .mockResolvedValue([{ availableCredits: wallet.availableCredits }])

  let selectCall = 0
  const selectFrom = vi.fn().mockImplementation(() => ({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockImplementation(() => {
        selectCall += 1
        if (selectCall === 1) return userSelectLimit()
        if (selectCall === 2) return bonusSelectLimit()
        return walletSelectLimit()
      }),
      for: walletSelectFor,
    }),
  }))
  const select = vi.fn().mockReturnValue({ from: selectFrom })

  const tx = { select, update, insert }
  const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx))
  const db = { select, transaction }

  withDbUserMock.mockImplementation(
    async (_userId: string, fn: (db: typeof db) => Promise<unknown>) => fn(db),
  )

  return { ledgerValues, updateSet, wallet, insert }
}

describe('grantStartingFreeCredits', () => {
  beforeEach(() => {
    withDbUserMock.mockReset()
  })

  it('grants STARTING_FREE_CREDITS once for production users', async () => {
    makeGrantMocks({ walletCredits: 0 })
    const { grantStartingFreeCredits } = await import('./wallet')
    const result = await grantStartingFreeCredits('u1')
    expect(result).toEqual({ granted: true, availableCredits: STARTING_FREE_CREDITS })
  })

  it('is idempotent when signup bonus already exists', async () => {
    makeGrantMocks({ existingBonus: true, walletCredits: STARTING_FREE_CREDITS })
    const { grantStartingFreeCredits } = await import('./wallet')
    const result = await grantStartingFreeCredits('u1')
    expect(result).toEqual({
      granted: false,
      availableCredits: STARTING_FREE_CREDITS,
    })
  })

  it('skips harness accounts', async () => {
    makeGrantMocks({ accountKind: 'harness', walletCredits: 0 })
    const { grantStartingFreeCredits } = await import('./wallet')
    const result = await grantStartingFreeCredits('u1')
    expect(result).toEqual({ granted: false, availableCredits: 0 })
  })
})
