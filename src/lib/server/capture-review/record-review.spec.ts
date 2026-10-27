import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upsertPendingCaptureReview: vi.fn(async (_input: unknown) => undefined),
  enqueueUserJob: vi.fn(
    async (
      _input: unknown,
    ): Promise<{ enqueued: true; jobId: string } | { enqueued: false; reason: 'duplicate' }> => ({
      enqueued: true,
      jobId: 'job-1',
    }),
  ),
}))

vi.mock('./review-store', () => ({
  upsertPendingCaptureReview: mocks.upsertPendingCaptureReview,
}))
vi.mock('$lib/server/job-queue/enqueue', () => ({ enqueueUserJob: mocks.enqueueUserJob }))

import { INGEST_MAX_RETRIES } from '$lib/server/ingest/retry'
import { CAPTURE_REVIEW_AUDIT_JOB, CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS } from './job'
import { recordCaptureReview } from './record-review'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsertPendingCaptureReview.mockResolvedValue(undefined)
  mocks.enqueueUserJob.mockResolvedValue({ enqueued: true, jobId: 'job-1' })
})

describe('recordCaptureReview', () => {
  it('upserts a pending review holding the jev_decision parts of the review kinds', async () => {
    await recordCaptureReview({
      userId: 'u1',
      thoughtId: 't1',
      decisions: [
        { kind: 'category', ref: 'category', choice: 'task', probability: 0.55 },
        { kind: 'entity_type', ref: 'm1', choice: 'person', probability: 0.8 },
        { kind: 'open_loop', ref: 'open_loop', choice: 'actionable', probability: 0.4 },
      ],
    })

    expect(mocks.upsertPendingCaptureReview).toHaveBeenCalledTimes(1)
    expect(mocks.upsertPendingCaptureReview).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 't1',
      parts: [
        {
          part: 'category',
          ref: 'category',
          engine: 'jev_decision',
          label: 'task',
          probability: 0.55,
        },
        {
          part: 'entity_type',
          ref: 'm1',
          engine: 'jev_decision',
          label: 'person',
          probability: 0.8,
        },
      ],
    })
  })

  it('writes a review with no parts when Jev decided nothing (the audit still scores it)', async () => {
    await recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] })
    expect(mocks.upsertPendingCaptureReview).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 't1',
      parts: [],
    })
  })

  it('enqueues exactly one audit job after the upsert, carrying only the thought id', async () => {
    await recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] })

    expect(mocks.enqueueUserJob).toHaveBeenCalledTimes(1)
    const job = mocks.enqueueUserJob.mock.calls[0][0] as Record<string, unknown>
    expect(job).toMatchObject({
      userId: 'u1',
      jobType: CAPTURE_REVIEW_AUDIT_JOB,
      payload: { thoughtId: 't1' },
    })
    expect(job.runAfter).toBeInstanceOf(Date)
    expect(mocks.upsertPendingCaptureReview.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueUserJob.mock.invocationCallOrder[0],
    )
  })

  it('gives the job the ingest policy: the first try plus exactly 3 retries', () => {
    expect(CAPTURE_REVIEW_AUDIT_JOB).toBe('capture_review_audit')
    expect(CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS).toBe(1 + INGEST_MAX_RETRIES)
    return recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] }).then(() => {
      expect(mocks.enqueueUserJob).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 4 }))
    })
  })

  it('does not dedupe on a key: every enrichment gets its own audit of the latest state', async () => {
    await recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] })
    expect(mocks.enqueueUserJob.mock.calls[0][0]).not.toHaveProperty('dedupeKey')
  })

  it('fails loudly when the review cannot be written, and enqueues nothing', async () => {
    mocks.upsertPendingCaptureReview.mockRejectedValueOnce(new Error('relation does not exist'))
    await expect(
      recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] }),
    ).rejects.toThrow('relation does not exist')
    expect(mocks.enqueueUserJob).not.toHaveBeenCalled()
  })

  it('fails loudly when the job cannot be enqueued', async () => {
    mocks.enqueueUserJob.mockRejectedValueOnce(new Error('queue down'))
    await expect(
      recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] }),
    ).rejects.toThrow('queue down')
  })

  it('fails loudly when the queue refuses the job as a duplicate (never a silent skip)', async () => {
    mocks.enqueueUserJob.mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' })
    await expect(
      recordCaptureReview({ userId: 'u1', thoughtId: 't1', decisions: [] }),
    ).rejects.toThrow(/not enqueued/)
  })

  it('is safe to run again for the same thought (retry or re-enrichment): same calls, no accumulation', async () => {
    const input = {
      userId: 'u1',
      thoughtId: 't1',
      decisions: [{ kind: 'category' as const, ref: 'category', choice: 'task', probability: 0.9 }],
    }
    await recordCaptureReview(input)
    await recordCaptureReview(input)
    expect(mocks.upsertPendingCaptureReview).toHaveBeenCalledTimes(2)
    expect(mocks.upsertPendingCaptureReview.mock.calls[0][0]).toEqual(
      mocks.upsertPendingCaptureReview.mock.calls[1][0],
    )
  })
})
