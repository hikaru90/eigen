import { describe, expect, it, vi, beforeEach } from 'vitest'
import { InsufficientCreditsError, adminGrantCredits, chargePlatformUsageMicroUsd } from './wallet'

const { mockEnv, withDbUserMock } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  withDbUserMock: vi.fn(),
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))

vi.mock('$lib/server/db', () => ({
  getDb: vi.fn(),
  withDbUser: withDbUserMock,
}))

function makeWalletRow(
  overrides: Partial<{
    availableCredits: number
    reservedCredits: number
    pendingBillingMicroUsd: number
  }> = {},
) {
  return {
    userId: 'u1',
    availableCredits: 1000,
    reservedCredits: 0,
    pendingBillingMicroUsd: 0,
    currency: 'USD',
    updatedAt: new Date(),
    ...overrides,
  }
}

function mockChargeTransaction(wallet: ReturnType<typeof makeWalletRow>) {
  const ledgerValues = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  const insert = vi.fn().mockImplementation(() => ({
    values: (row: unknown) => {
      const result = ledgerValues(row)
      return {
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      }
    },
  }))
  const selectLimit = vi.fn().mockResolvedValue([wallet])
  const selectFor = vi.fn().mockResolvedValue([wallet])
  const selectWhere = vi.fn().mockReturnValue({
    for: selectFor,
    limit: selectLimit,
  })
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere })
  const select = vi.fn().mockReturnValue({ from: selectFrom })
  const tx = {
    select,
    update,
    insert,
  }
  const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx))
  withDbUserMock.mockImplementation(
    async (_userId: string, fn: (db: { transaction: typeof transaction }) => Promise<unknown>) =>
      fn({ transaction }),
  )
  return { ledgerValues, updateSet, wallet, transaction }
}

describe('InsufficientCreditsError', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key]
    }
  })

  it('includes available and required amounts in the message', () => {
    const err = new InsufficientCreditsError({
      phase: 'precheck',
      availableCredits: 100,
      requiredCredits: 500,
    })
    expect(err.message).toContain('100 credits')
    expect(err.message).toContain('500 credits')
    expect(err.availableCredits).toBe(100)
    expect(err.requiredCredits).toBe(500)
  })
})

describe('adminGrantCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('credits the wallet and writes an adjustment ledger row', async () => {
    const wallet = makeWalletRow({ availableCredits: 0 })
    const { ledgerValues, updateSet } = mockChargeTransaction(wallet)

    const result = await adminGrantCredits({
      userId: 'u1',
      amountCredits: 41,
      reason: 'Refund overnight repair overcharge',
      adminUserId: 'admin1',
    })

    expect(result).toEqual({ availableCredits: 41 })
    expect(withDbUserMock).toHaveBeenCalledWith('u1', expect.any(Function))
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ availableCredits: 41 }))
    expect(ledgerValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        kind: 'adjustment',
        amountCredits: 41,
        referenceType: 'admin_grant',
        referenceId: 'admin1',
        metadata: expect.objectContaining({
          reason: 'Refund overnight repair overcharge',
          adminUserId: 'admin1',
        }),
      }),
    )
  })

  it('rejects non-positive or non-integer amounts', async () => {
    await expect(
      adminGrantCredits({
        userId: 'u1',
        amountCredits: 0,
        reason: 'x',
        adminUserId: 'admin1',
      }),
    ).rejects.toThrow(/positive integer/)
    await expect(
      adminGrantCredits({
        userId: 'u1',
        amountCredits: 1.5,
        reason: 'x',
        adminUserId: 'admin1',
      }),
    ).rejects.toThrow(/positive integer/)
  })

  it('rejects empty reason', async () => {
    await expect(
      adminGrantCredits({
        userId: 'u1',
        amountCredits: 10,
        reason: '   ',
        adminUserId: 'admin1',
      }),
    ).rejects.toThrow(/reason/)
  })
})

describe('chargePlatformUsageMicroUsd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('debits whole credits and writes usage_debit ledger row', async () => {
    const wallet = makeWalletRow({ availableCredits: 100, pendingBillingMicroUsd: 0 })
    const { ledgerValues, updateSet } = mockChargeTransaction(wallet)

    const debited = await chargePlatformUsageMicroUsd('u1', 12000, { baseUsd: 0.01 })

    expect(debited).toBe(12)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        availableCredits: 88,
        pendingBillingMicroUsd: 0,
      }),
    )
    expect(ledgerValues).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'usage_debit',
        amountCredits: -12,
      }),
    )
  })

  it('accumulates sub-credit pending without debiting until threshold', async () => {
    const wallet = makeWalletRow({ availableCredits: 100, pendingBillingMicroUsd: 500 })
    const { ledgerValues, updateSet } = mockChargeTransaction(wallet)

    const debited = await chargePlatformUsageMicroUsd('u1', 400, { baseUsd: 0.0004 })

    expect(debited).toBe(0)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        availableCredits: 100,
        pendingBillingMicroUsd: 900,
      }),
    )
    expect(ledgerValues).not.toHaveBeenCalled()
  })

  it('throws InsufficientCreditsError at settle when balance is too low', async () => {
    const wallet = makeWalletRow({ availableCredits: 5, pendingBillingMicroUsd: 0 })
    mockChargeTransaction(wallet)

    await expect(
      chargePlatformUsageMicroUsd('u1', 12000, { baseUsd: 0.01 }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError)
  })
})
