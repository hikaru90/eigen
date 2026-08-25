import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBHOOK_DELIVERY_JOB } from './constants'

const {
  withDbUserMock,
  processWebhookDeliveryJobMock,
  processOvernightMock,
  processOnboardingMock,
  createAdminSqlMock,
} = vi.hoisted(() => ({
  withDbUserMock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => fn()),
  processWebhookDeliveryJobMock: vi.fn(async () => undefined),
  processOvernightMock: vi.fn(async () => undefined),
  processOnboardingMock: vi.fn(async () => undefined),
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
