import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isGraphScaleSpendProbeUser,
  isHarnessUser,
  shouldScheduleDevCaptureEnrichWorker,
} from './harness-account'

const { authDbSelectMock } = vi.hoisted(() => ({
  authDbSelectMock: vi.fn(),
}))

vi.mock('$lib/server/db/auth-db', () => ({
  authDb: {
    select: authDbSelectMock,
  },
}))

function mockHarnessLookup(accountKind: string | undefined) {
  const limit = vi.fn().mockResolvedValue(accountKind === undefined ? [] : [{ accountKind }])
  const where = vi.fn().mockReturnValue({ limit })
  authDbSelectMock.mockReturnValue({ from: vi.fn().mockReturnValue({ where }) })
}

describe('isGraphScaleSpendProbeUser', () => {
  it('matches graph-scale spend probe ids', () => {
    expect(isGraphScaleSpendProbeUser('graph-scale-spend-abc')).toBe(true)
    expect(isGraphScaleSpendProbeUser('graph-scale-corpus-run-1')).toBe(false)
  })
})

describe('shouldScheduleDevCaptureEnrichWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows graph-scale spend probe users even when harness', async () => {
    mockHarnessLookup('harness')
    await expect(shouldScheduleDevCaptureEnrichWorker('graph-scale-spend-abc')).resolves.toBe(true)
  })

  it('blocks graph-scale corpus harness tenants', async () => {
    mockHarnessLookup('harness')
    await expect(shouldScheduleDevCaptureEnrichWorker('graph-scale-corpus-run-1-10')).resolves.toBe(
      false,
    )
  })

  it('allows normal production users', async () => {
    mockHarnessLookup('production')
    await expect(shouldScheduleDevCaptureEnrichWorker('user-1')).resolves.toBe(true)
    expect(await isHarnessUser('user-1')).toBe(false)
  })

  it('blocks other harness users', async () => {
    mockHarnessLookup('harness')
    await expect(shouldScheduleDevCaptureEnrichWorker('eval-corpus-x')).resolves.toBe(false)
  })
})
