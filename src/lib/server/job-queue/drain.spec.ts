import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_REVIEW_AUDIT_JOB, WEBHOOK_DELIVERY_JOB } from './constants'

const {
  withDbUserMock,
  processWebhookDeliveryJobMock,
  processOvernightMock,
  processOnboardingMock,
  processCaptureReviewAuditMock,
  createAdminSqlMock,
} = vi.hoisted(() => ({
  withDbUserMock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => fn()),
  processWebhookDeliveryJobMock: vi.fn(async () => undefined),
  processOvernightMock: vi.fn(async () => undefined),
  processOnboardingMock: vi.fn(async () => undefined),
  processCaptureReviewAuditMock: vi.fn(async (_job: unknown) => undefined),
  createAdminSqlMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

vi.mock('$lib/server/agents/deliver', () => ({
  WebhookDeliveryError: class WebhookDeliveryError extends Error {
    options?: { httpStatus?: number; permanent?: boolean }
    constructor(message: string, options?: { httpStatus?: number; permanent?: boolean }) {
      super(message)
      this.options = options
    }
  },
  processWebhookDeliveryJob: processWebhookDeliveryJobMock,
  markWebhookDeliveryFailed: vi.fn(),
  disableConnectedAgent: vi.fn(),
  loadWebhookDeliveryAgentId: vi.fn(),
}))

vi.mock('./process-overnight', () => ({
  processOvernightConsolidationJob: processOvernightMock,
}))

vi.mock('$lib/server/grounding/onboarding-welcome-push', () => ({
  processOnboardingGroundingPushJob: processOnboardingMock,
}))

vi.mock('$lib/server/capture-review/audit-job', () => ({
  processCaptureReviewAuditJob: processCaptureReviewAuditMock,
}))

vi.mock('./admin-db', () => ({
  createAdminSql: createAdminSqlMock,
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({
    update: () => ({
      set: () => ({
        where: vi.fn(async () => undefined),
      }),
    }),
  }),
}))

import { defaultProductionOnlyForDrain, drainUserJobQueue } from './drain'

function claimedWebhookRow(userId: string) {
  return {
    id: 'job-1',
    user_id: userId,
    job_type: WEBHOOK_DELIVERY_JOB,
    status: 'running',
    payload: { deliveryId: 'del-1' },
    run_after: new Date(),
    dedupe_key: null,
    attempt_count: 1,
    max_attempts: 3,
    last_error: null,
    heartbeat_run_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    started_at: new Date(),
    finished_at: null,
  }
}

describe('defaultProductionOnlyForDrain', () => {
  it('defaults to production-only for global ticker drain', () => {
    expect(defaultProductionOnlyForDrain()).toBe(true)
    expect(defaultProductionOnlyForDrain({})).toBe(true)
  })

  it('allows harness jobs when draining a specific user (manual run)', () => {
    expect(defaultProductionOnlyForDrain({ userId: 'harness-user' })).toBe(false)
  })

  it('honors an explicit productionOnly override', () => {
    expect(defaultProductionOnlyForDrain({ userId: 'u1', productionOnly: true })).toBe(true)
    expect(defaultProductionOnlyForDrain({ productionOnly: false })).toBe(false)
  })
})

describe('drainUserJobQueue DB context', () => {
  beforeEach(() => {
    withDbUserMock.mockClear()
    processWebhookDeliveryJobMock.mockClear()
    processOvernightMock.mockClear()
    processOnboardingMock.mockClear()
    createAdminSqlMock.mockReset()

    const tx = vi.fn(async () => [claimedWebhookRow('user-webhook')])
    createAdminSqlMock.mockReturnValue({
      begin: async (fn: (sql: typeof tx) => Promise<unknown>) => fn(tx),
      end: vi.fn(async () => undefined),
    })
  })

  it('wraps each claimed job in withDbUser so getDb/decrypt work outside HTTP', async () => {
    const result = await drainUserJobQueue({ userId: 'user-webhook', productionOnly: false })

    expect(result.claimed).toBe(1)
    expect(result.completed).toBe(1)
    expect(withDbUserMock).toHaveBeenCalledWith('user-webhook', expect.any(Function))
    expect(processWebhookDeliveryJobMock).toHaveBeenCalled()
  })
})

describe('drainUserJobQueue capture_review_audit dispatch', () => {
  function claimedAuditRow(overrides: { attempt_count: number; max_attempts: number }) {
    return {
      ...claimedWebhookRow('user-audit'),
      job_type: CAPTURE_REVIEW_AUDIT_JOB,
      payload: { thoughtId: 't1' },
      ...overrides,
    }
  }

  function claim(row: ReturnType<typeof claimedAuditRow>) {
    const tx = vi.fn(async () => [row])
    createAdminSqlMock.mockReturnValue({
      begin: async (fn: (sql: typeof tx) => Promise<unknown>) => fn(tx),
      end: vi.fn(async () => undefined),
    })
  }

  beforeEach(() => {
    processCaptureReviewAuditMock.mockReset()
    processCaptureReviewAuditMock.mockResolvedValue(undefined)
    withDbUserMock.mockClear()
    createAdminSqlMock.mockReset()
  })

  it('hands the claimed job to the audit handler inside the tenant context', async () => {
    claim(claimedAuditRow({ attempt_count: 0, max_attempts: 4 }))

    const result = await drainUserJobQueue({ userId: 'user-audit', productionOnly: false })

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 })
    expect(withDbUserMock).toHaveBeenCalledWith('user-audit', expect.any(Function))
    expect(processCaptureReviewAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'job-1',
        userId: 'user-audit',
        jobType: CAPTURE_REVIEW_AUDIT_JOB,
        payload: { thoughtId: 't1' },
        // the claim counts this try: attempt_count 0 becomes 1 of 4
        attemptCount: 1,
        maxAttempts: 4,
      }),
    )
  })

  it('requeues a failed audit while attempts remain, and gives it up on the last one', async () => {
    processCaptureReviewAuditMock.mockRejectedValue(new Error('audit failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    claim(claimedAuditRow({ attempt_count: 1, max_attempts: 4 }))
    expect(await drainUserJobQueue({ userId: 'user-audit', productionOnly: false })).toEqual({
      claimed: 1,
      completed: 0,
      failed: 0,
    })

    // the 4th and last try (attempt_count 3 + this claim = 4 of 4)
    claim(claimedAuditRow({ attempt_count: 3, max_attempts: 4 }))
    expect(await drainUserJobQueue({ userId: 'user-audit', productionOnly: false })).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
    })
    errorSpy.mockRestore()
  })
})
