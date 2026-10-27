import type { CaptureAuditInput } from './audit-questions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reenrichThought: vi.fn(),
  recordCaptureReview: vi.fn(),
  loadCaptureReviewForAudit: vi.fn(),
  resetCaptureReviewToPending: vi.fn(),
  enqueueUserJob: vi.fn(),
  redoCaptureSplit: vi.fn(),
  readSplitFamily: vi.fn(),
  loadCaptureAuditInput: vi.fn(),
  select: vi.fn(),
}))

vi.mock('$lib/server/capture/enrich', () => ({ reenrichThought: mocks.reenrichThought }))
vi.mock('./record-review', () => ({ recordCaptureReview: mocks.recordCaptureReview }))
vi.mock('./review-store', () => ({
  loadCaptureReviewForAudit: mocks.loadCaptureReviewForAudit,
  resetCaptureReviewToPending: mocks.resetCaptureReviewToPending,
}))
vi.mock('$lib/server/job-queue/enqueue', () => ({ enqueueUserJob: mocks.enqueueUserJob }))
vi.mock('$lib/server/memory/split-multi-task', () => ({
  redoCaptureSplit: mocks.redoCaptureSplit,
  readSplitFamily: mocks.readSplitFamily,
}))
vi.mock('./audit-input', () => ({ loadCaptureAuditInput: mocks.loadCaptureAuditInput }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: vi.fn() }))
vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.select }) }) }),
  }),
}))

import { recordDecision } from './decision-recorder'
import { CAPTURE_REVIEW_AUDIT_JOB } from './job'
import { recheckStoredData, snapshotStoredData } from './recheck'

const CORRECTION = 'wrong day, I said Friday'
const AUDIT: CaptureAuditInput = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Dentist on Friday',
  storedText: 'Dentist on Friday',
  names: [{ ref: 'n1', surface: 'Dr Weber' }],
  dates: [{ ref: 'd1', event: 'Dentist', day: '2026-10-30', detail: null }],
  pieces: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockResolvedValue([
    { normalizedText: 'Dentist on Friday', normalizedTextEncrypted: null },
  ])
  mocks.reenrichThought.mockResolvedValue(undefined)
  mocks.recordCaptureReview.mockResolvedValue(undefined)
  mocks.loadCaptureReviewForAudit.mockResolvedValue({
    status: 'scored',
    parts: [
      {
        part: 'category',
        ref: 'category',
        engine: 'jev_decision',
        label: 'task',
        probability: 0.9,
      },
      { part: 'entity_type', ref: 'm1', engine: 'jev_decision', label: 'person', probability: 0.8 },
      { part: 'date', ref: 'date:d1', engine: 'jev_audit', label: 'right', probability: 0.9 },
    ],
  })
  mocks.resetCaptureReviewToPending.mockResolvedValue(true)
  mocks.enqueueUserJob.mockResolvedValue({ enqueued: true, jobId: 'j' })
  mocks.redoCaptureSplit.mockResolvedValue({ parentId: 'parent-1', tasks: [] })
})

describe('recheckStoredData: dates, names, links, category', () => {
  it('re-enriches the thought with the owner correction as context only', async () => {
    await recheckStoredData({
      userId: 'u1',
      thoughtId: 't1',
      reasonKind: 'wrong_date',
      correction: CORRECTION,
    })

    expect(mocks.reenrichThought).toHaveBeenCalledWith('u1', 't1', 'Dentist on Friday', {
      ownerCorrection: CORRECTION,
    })
    expect(mocks.redoCaptureSplit).not.toHaveBeenCalled()
  })

  it('rebuilds the review from the decisions of that pass, keeping the capture-time category', async () => {
    mocks.reenrichThought.mockImplementation(async () => {
      recordDecision({ kind: 'entity_type', ref: 'm1', choice: 'organization', probability: 0.7 })
    })

    await recheckStoredData({
      userId: 'u1',
      thoughtId: 't1',
      reasonKind: 'wrong_name',
      correction: CORRECTION,
    })

    expect(mocks.recordCaptureReview).toHaveBeenCalledTimes(1)
    const { decisions } = mocks.recordCaptureReview.mock.calls[0][0] as {
      decisions: Array<{ kind: string; choice: string }>
    }
    // the category decided at capture carries over; the old entity_type is replaced by the new one
    expect(decisions).toEqual([
      { kind: 'category', ref: 'category', choice: 'task', probability: 0.9 },
      { kind: 'entity_type', ref: 'm1', choice: 'organization', probability: 0.7 },
    ])
  })

  it('retries a failing re-enrichment exactly 3 times, then throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.reenrichThought.mockRejectedValue(new Error('enrich down'))

    await expect(
      recheckStoredData({
        userId: 'u1',
        thoughtId: 't1',
        reasonKind: 'wrong_date',
        correction: CORRECTION,
      }),
    ).rejects.toThrow()
    expect(mocks.reenrichThought).toHaveBeenCalledTimes(4)
    expect(mocks.recordCaptureReview).not.toHaveBeenCalled()
  }, 60_000)

  it('refuses a reason kind that is edit-only', async () => {
    await expect(
      recheckStoredData({
        userId: 'u1',
        thoughtId: 't1',
        reasonKind: 'wording_changed',
        correction: CORRECTION,
      }),
    ).rejects.toThrow(/no re-check/)
    expect(mocks.reenrichThought).not.toHaveBeenCalled()
  })
})

describe('recheckStoredData: split_wrong', () => {
  it('redoes the split with the correction and queues a new audit of the parent', async () => {
    await recheckStoredData({
      userId: 'u1',
      thoughtId: 'child-1',
      reasonKind: 'split_wrong',
      correction: CORRECTION,
    })

    expect(mocks.redoCaptureSplit).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 'child-1',
      ownerCorrection: CORRECTION,
    })
    expect(mocks.reenrichThought).not.toHaveBeenCalled()
    expect(mocks.resetCaptureReviewToPending).toHaveBeenCalledWith('parent-1')
    expect(mocks.enqueueUserJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: CAPTURE_REVIEW_AUDIT_JOB,
        payload: { thoughtId: 'parent-1' },
      }),
    )
  })

  it('queues nothing when the parent has no review', async () => {
    mocks.resetCaptureReviewToPending.mockResolvedValue(false)
    await recheckStoredData({
      userId: 'u1',
      thoughtId: 't1',
      reasonKind: 'split_wrong',
      correction: CORRECTION,
    })
    expect(mocks.enqueueUserJob).not.toHaveBeenCalled()
  })

  it('passes a failed redo up', async () => {
    mocks.redoCaptureSplit.mockRejectedValue(new Error('judge down'))
    await expect(
      recheckStoredData({
        userId: 'u1',
        thoughtId: 't1',
        reasonKind: 'split_wrong',
        correction: CORRECTION,
      }),
    ).rejects.toThrow('judge down')
  })
})

describe('recheckStoredData: logs', () => {
  it('logs the length of the correction at most', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await recheckStoredData({
      userId: 'u1',
      thoughtId: 't1',
      reasonKind: 'wrong_date',
      correction: CORRECTION,
    })
    const logged = JSON.stringify(info.mock.calls)
    expect(logged).not.toContain('Friday')
    expect(logged).toContain(String(CORRECTION.length))
  })
})

describe('snapshotStoredData', () => {
  beforeEach(() => {
    mocks.loadCaptureAuditInput.mockResolvedValue(AUDIT)
    mocks.select.mockResolvedValue([{ category: 'task', lifecycleStatus: 'open' }])
    mocks.readSplitFamily.mockResolvedValue(null)
  })

  const snap = () => snapshotStoredData({ userId: 'u1', thoughtId: 't1' })

  it('is the same string for the same stored data', async () => {
    expect(await snap()).toBe(await snap())
  })

  it.each([
    [
      'a date',
      () =>
        mocks.loadCaptureAuditInput.mockResolvedValue({
          ...AUDIT,
          dates: [{ ...AUDIT.dates[0], day: '2026-10-31' }],
        }),
    ],
    [
      'a time',
      () =>
        mocks.loadCaptureAuditInput.mockResolvedValue({
          ...AUDIT,
          dates: [{ ...AUDIT.dates[0], detail: 'at 09:00' }],
        }),
    ],
    [
      'a name',
      () =>
        mocks.loadCaptureAuditInput.mockResolvedValue({
          ...AUDIT,
          names: [{ ref: 'n1', surface: 'Dr Weber-Klein' }],
        }),
    ],
    [
      'the stored text',
      () =>
        mocks.loadCaptureAuditInput.mockResolvedValue({
          ...AUDIT,
          storedText: 'Dentist on Saturday',
        }),
    ],
    [
      'the pieces',
      () =>
        mocks.loadCaptureAuditInput.mockResolvedValue({
          ...AUDIT,
          pieces: [{ ref: 'p1', text: 'a' }],
        }),
    ],
    [
      'the category',
      () => mocks.select.mockResolvedValue([{ category: 'idea', lifecycleStatus: 'open' }]),
    ],
    [
      'the status',
      () => mocks.select.mockResolvedValue([{ category: 'task', lifecycleStatus: 'completed' }]),
    ],
    [
      'a child of the split',
      () =>
        mocks.readSplitFamily.mockResolvedValue({
          parentId: 'p',
          pieces: ['a', 'b'],
          children: [{ id: 'c1', lifecycleStatus: 'archived' }],
        }),
    ],
  ])('differs when %s differs', async (_what, change) => {
    const before = await snap()
    change()
    expect(await snap()).not.toBe(before)
  })

  it('does not depend on the order the children are listed in', async () => {
    const family = (children: Array<{ id: string; lifecycleStatus: string }>) =>
      mocks.readSplitFamily.mockResolvedValue({ parentId: 'p', pieces: [], children })
    family([
      { id: 'a', lifecycleStatus: 'open' },
      { id: 'b', lifecycleStatus: 'open' },
    ])
    const one = await snap()
    family([
      { id: 'b', lifecycleStatus: 'open' },
      { id: 'a', lifecycleStatus: 'open' },
    ])
    expect(await snap()).toBe(one)
  })

  it('throws for a thought that no longer exists', async () => {
    mocks.loadCaptureAuditInput.mockResolvedValue(null)
    await expect(snap()).rejects.toThrow(/does not exist/)
  })
})
