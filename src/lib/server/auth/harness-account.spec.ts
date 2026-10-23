import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isGraphScaleSpendProbeUser,
  isHarnessUser,
  resolveE2eHarnessBillingFor,
  shouldScheduleDevCaptureEnrichWorker,
} from './harness-account'
import { EVAL_OPERATOR_USER_ID } from './harness-billing'

const { authDbSelectMock } = vi.hoisted(() => ({
  authDbSelectMock: vi.fn(),
}))

const { env } = vi.hoisted(() => ({ env: { dev: true } }))
vi.mock('$app/environment', () => ({
  get dev() {
    return env.dev
  },
}))

vi.mock('$lib/server/db/auth-db', () => ({
  authDb: {
    select: authDbSelectMock,
  },
}))

function mockHarnessLookup(accountKind: string | undefined, email = 'someone@local.eval') {
  const limit = vi
    .fn()
    .mockResolvedValue(accountKind === undefined ? [] : [{ accountKind, email }])
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

describe('Playwright harness accounts (e2e-…@test.eigen)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.dev = true
  })

  it('run the dev enrich worker, billed to the eval operator service wallet', async () => {
    mockHarnessLookup('harness', 'e2e-1792-1@test.eigen')
    await expect(shouldScheduleDevCaptureEnrichWorker('random-id')).resolves.toBe(true)
    await expect(resolveE2eHarnessBillingFor('random-id')).resolves.toBe(EVAL_OPERATOR_USER_ID)
  })

  it('other harness accounts on test.eigen stay blocked and self-billed', async () => {
    mockHarnessLookup('harness', 'design-review-1@test.eigen')
    await expect(shouldScheduleDevCaptureEnrichWorker('random-id')).resolves.toBe(false)
    await expect(resolveE2eHarnessBillingFor('random-id')).resolves.toBeUndefined()
  })

  it('a production account with an e2e-looking email is never service-billed', async () => {
    mockHarnessLookup('production', 'e2e-1@test.eigen')
    await expect(resolveE2eHarnessBillingFor('random-id')).resolves.toBeUndefined()
  })

  it('never applies outside the dev server', async () => {
    env.dev = false
    mockHarnessLookup('harness', 'e2e-1@test.eigen')
    await expect(resolveE2eHarnessBillingFor('random-id')).resolves.toBeUndefined()
  })
})
