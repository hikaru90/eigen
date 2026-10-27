import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserJobQueue } from '$lib/server/db/schema'

const mocks = vi.hoisted(() => ({
  runCaptureReviewAudit: vi.fn(async (_input: unknown) => undefined),
}))

vi.mock('./run-audit', () => ({ runCaptureReviewAudit: mocks.runCaptureReviewAudit }))

import { processCaptureReviewAuditJob } from './audit-job'
import { CAPTURE_REVIEW_AUDIT_JOB, parseCaptureReviewAuditPayload } from './job'

function job(overrides: Partial<UserJobQueue> = {}): UserJobQueue {
  return {
    id: 'job-1',
    userId: 'u1',
    jobType: CAPTURE_REVIEW_AUDIT_JOB,
    status: 'running',
    payload: { thoughtId: 't1' },
    runAfter: new Date(),
    dedupeKey: null,
    attemptCount: 1,
    maxAttempts: 4,
    lastError: null,
    heartbeatRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runCaptureReviewAudit.mockResolvedValue(undefined)
})

describe('processCaptureReviewAuditJob', () => {
  it("audits the payload's thought for the job's user, passing the job's attempt counters", async () => {
    await processCaptureReviewAuditJob(job({ attemptCount: 2, maxAttempts: 4 }))

    expect(mocks.runCaptureReviewAudit).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 't1',
      attempt: 2,
      maxAttempts: 4,
    })
  })

  it('lets the audit failure through, so the queue retries or gives the job up', async () => {
    mocks.runCaptureReviewAudit.mockRejectedValue(new Error('audit failed'))
    await expect(processCaptureReviewAuditJob(job())).rejects.toThrow('audit failed')
  })

  it('fails loudly on a payload that is not exactly { thoughtId }, without auditing', async () => {
    for (const payload of [
      {},
      { thoughtId: '' },
      { thoughtId: 7 },
      { thoughtId: 't1', extra: 1 },
    ]) {
      await expect(processCaptureReviewAuditJob(job({ payload }))).rejects.toThrow(/payload/)
    }
    expect(mocks.runCaptureReviewAudit).not.toHaveBeenCalled()
  })
})

describe('parseCaptureReviewAuditPayload', () => {
  it('accepts the thought id and trims nothing else in', () => {
    expect(parseCaptureReviewAuditPayload({ thoughtId: 't1' })).toEqual({ thoughtId: 't1' })
  })
})
