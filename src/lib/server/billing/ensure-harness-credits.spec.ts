import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_SCALE_OPERATOR_USER_ID } from '$lib/server/auth/harness-billing'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { HARNESS_TEST_TOP_UP_CREDITS } from './ensure-harness-credits'

const { withDbUserMock, getOrCreateWalletMock, creditFromPaymentMock, dbInsertMock } = vi.hoisted(
  () => ({
    withDbUserMock: vi.fn(),
    getOrCreateWalletMock: vi.fn(),
    creditFromPaymentMock: vi.fn(),
    dbInsertMock: vi.fn(),
  }),
)

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

vi.mock('$lib/server/billing/wallet', () => ({
  getOrCreateWallet: getOrCreateWalletMock,
  creditFromPayment: creditFromPaymentMock,
}))

describe('ensureHarnessWalletCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    withDbUserMock.mockImplementation(
      async (_userId: string, fn: (db: unknown) => Promise<unknown>) =>
        fn({ insert: dbInsertMock }),
    )
    dbInsertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'pay-1' }]),
      }),
    })
    creditFromPaymentMock.mockResolvedValue({
      credited: true,
      availableCredits: HARNESS_TEST_TOP_UP_CREDITS,
    })
  })

  it('skips top-up when operator wallet already has credits', async () => {
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 10_000 })
    const { ensureHarnessWalletCredits } = await import('./ensure-harness-credits')
    const result = await ensureHarnessWalletCredits('graph-scale-corpus-run-1')
    expect(result).toEqual({
      billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
      availableCredits: 10_000,
    })
    expect(creditFromPaymentMock).not.toHaveBeenCalled()
  })

  it('tops up graph-scale operator when corpus tenant has no wallet', async () => {
    getOrCreateWalletMock
      .mockResolvedValueOnce({ availableCredits: 0 })
      .mockResolvedValueOnce({ availableCredits: HARNESS_TEST_TOP_UP_CREDITS })
      .mockResolvedValueOnce({ availableCredits: 0 })
      .mockResolvedValueOnce({ availableCredits: HARNESS_TEST_TOP_UP_CREDITS })
    const { ensureHarnessWalletCredits } = await import('./ensure-harness-credits')
    const result = await ensureHarnessWalletCredits('graph-scale-corpus-run-uuid-1')
    expect(withDbUserMock).toHaveBeenCalledWith(GRAPH_SCALE_OPERATOR_USER_ID, expect.any(Function))
    expect(withDbUserMock).toHaveBeenCalledWith(
      'graph-scale-corpus-run-uuid-1',
      expect.any(Function),
    )
    expect(creditFromPaymentMock).toHaveBeenCalledTimes(2)
    expect(result.availableCredits).toBe(HARNESS_TEST_TOP_UP_CREDITS)
  })

  it('respects custom minimum threshold', async () => {
    getOrCreateWalletMock
      .mockResolvedValueOnce({ availableCredits: MIN_CAPTURE_PIPELINE_CREDITS })
      .mockResolvedValueOnce({ availableCredits: 1000 })
    const { ensureHarnessWalletCredits } = await import('./ensure-harness-credits')
    await ensureHarnessWalletCredits('graph-scale-runner', {
      minCredits: MIN_CAPTURE_PIPELINE_CREDITS + 1,
    })
    expect(creditFromPaymentMock).toHaveBeenCalled()
  })
})
