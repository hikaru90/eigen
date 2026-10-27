import type { CaptureAuditInput } from './audit-questions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadVoteTarget: vi.fn(),
  createPendingCaptureReviewIfMissing: vi.fn(),
  deleteCaptureReview: vi.fn(),
  saveCaptureVote: vi.fn(),
  enqueueUserJob: vi.fn(),
  loadCaptureAuditInput: vi.fn(),
  runCaptureReasonLabel: vi.fn(),
  editStoredThought: vi.fn(),
  encryptTenantValue: vi.fn(),
}))

vi.mock('./vote-store', () => ({
  loadVoteTarget: mocks.loadVoteTarget,
  createPendingCaptureReviewIfMissing: mocks.createPendingCaptureReviewIfMissing,
  deleteCaptureReview: mocks.deleteCaptureReview,
  saveCaptureVote: mocks.saveCaptureVote,
}))
vi.mock('$lib/server/job-queue/enqueue', () => ({ enqueueUserJob: mocks.enqueueUserJob }))
vi.mock('./audit-input', () => ({ loadCaptureAuditInput: mocks.loadCaptureAuditInput }))
vi.mock('$lib/server/llm/decision-plane', () => ({
  runCaptureReasonLabel: mocks.runCaptureReasonLabel,
}))
vi.mock('$lib/server/capture/service', () => ({ editStoredThought: mocks.editStoredThought }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: mocks.encryptTenantValue,
}))

import { INGEST_MAX_RETRIES } from '$lib/server/ingest/retry'
import { CAPTURE_REVIEW_AUDIT_JOB, CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS } from './job'
import { CAPTURE_REASON_KINDS } from './reason-question'
import { CaptureVoteError, voteOnCapture } from './vote'
import { CaptureVoteInputError } from './vote-input'

const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'
const RAW = 'Call my sister Anna on Friday about the tickets'
const REASON = 'it is about my sister Greta, not Anna'

const AUDIT: CaptureAuditInput = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: RAW,
  storedText: RAW,
  names: [{ ref: 'n1', surface: 'Anna' }],
  dates: [{ ref: 'd1', event: 'Call Anna', day: '2026-10-30', detail: 'at 09:00' }],
  pieces: [],
}
const SUMMARY =
  'Saved as Task · about Anna · Call Anna: the Friday after the capture day (3 days later) at 09:00, once (not repeating)'

const EDITED_THOUGHT = { id: ID, normalizedText: 'Call my sister Greta on Friday', category: 'task' }

type Vote = Parameters<typeof voteOnCapture>[0]

function vote(patch: Partial<Vote> = {}): Promise<Awaited<ReturnType<typeof voteOnCapture>>> {
  return voteOnCapture({
    userId: 'u1',
    thoughtId: ID,
    verdict: 'down',
    place: 'mesh',
    reason: REASON,
    ...patch,
  })
}

function savedVote(call = 0): Record<string, unknown> {
  return mocks.saveCaptureVote.mock.calls[call][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadVoteTarget.mockResolvedValue({ category: 'task' })
  mocks.createPendingCaptureReviewIfMissing.mockResolvedValue(null)
  mocks.deleteCaptureReview.mockResolvedValue(undefined)
  mocks.saveCaptureVote.mockResolvedValue(undefined)
  mocks.enqueueUserJob.mockResolvedValue({ enqueued: true, jobId: 'job-1' })
  mocks.loadCaptureAuditInput.mockResolvedValue(AUDIT)
  mocks.runCaptureReasonLabel.mockResolvedValue({ kind: 'wrong_name', probability: 0.91 })
  mocks.editStoredThought.mockResolvedValue({ ok: true, thought: EDITED_THOUGHT, editSummary: 's' })
  mocks.encryptTenantValue.mockImplementation(
    async (input: { plaintext: string }) => `enc(${input.plaintext.length})`,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('voteOnCapture: thumbs-up', () => {
  it('stores the verdict, the place and nothing else — no label, no edit', async () => {
    const result = await vote({ verdict: 'up', reason: undefined, place: 'capture' })

    expect(result).toEqual({
      verdict: 'up',
      reasonKind: null,
      editApplied: false,
      editError: null,
      thought: null,
    })
    expect(mocks.saveCaptureVote).toHaveBeenCalledTimes(1)
    expect(savedVote()).toEqual({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'up',
      place: 'capture',
      reasonEncrypted: null,
      reasonKind: null,
    })
    expect(mocks.runCaptureReasonLabel).not.toHaveBeenCalled()
    expect(mocks.editStoredThought).not.toHaveBeenCalled()
    expect(mocks.loadCaptureAuditInput).not.toHaveBeenCalled()
  })

  it('keeps edit_applied_at as it is (the column is not named in the write)', async () => {
    await vote({ verdict: 'up', reason: undefined })
    expect(Object.keys(savedVote())).not.toContain('editAppliedAt')
  })

  it('clears a reason and kind left by an earlier thumbs-down', async () => {
    await vote({ verdict: 'up', reason: undefined })
    expect(savedVote()).toMatchObject({ reasonEncrypted: null, reasonKind: null })
  })
})

describe('voteOnCapture: a vote from an agent over MCP', () => {
  it('hands the mcp place to the store as it is (the store maps it to NULL in one place)', async () => {
    await vote({ verdict: 'up', reason: undefined, place: 'mcp' })
    expect(savedVote()).toMatchObject({ verdict: 'up', place: 'mcp' })
  })

  it('a thumbs-down with a reason from an agent labels, edits and stores the same way', async () => {
    const result = await vote({ place: 'mcp' })
    expect(result).toMatchObject({ reasonKind: 'wrong_name', editApplied: true, editError: null })
    expect(mocks.editStoredThought).toHaveBeenCalledWith('u1', ID, REASON)
    expect(savedVote()).toMatchObject({ verdict: 'down', place: 'mcp', reasonKind: 'wrong_name' })
  })
})

describe('voteOnCapture: thumbs-down without a reason', () => {
  it.each([undefined, '', '   ', '\n\t '])(
    'stores only the verdict for reason %j: no edit, no label',
    async (reason) => {
      const result = await vote({ reason })

      expect(result).toEqual({
        verdict: 'down',
        reasonKind: null,
        editApplied: false,
        editError: null,
        thought: null,
      })
      expect(savedVote()).toEqual({
        userId: 'u1',
        thoughtId: ID,
        verdict: 'down',
        place: 'mesh',
        reasonEncrypted: null,
        reasonKind: null,
      })
      expect(mocks.runCaptureReasonLabel).not.toHaveBeenCalled()
      expect(mocks.editStoredThought).not.toHaveBeenCalled()
      expect(mocks.encryptTenantValue).not.toHaveBeenCalled()
    },
  )
})

describe('voteOnCapture: thumbs-down with a reason', () => {
  it('labels the kind of mistake with the pre-edit stored summary, applies the reason as an edit, then stores everything', async () => {
    const before = Date.now()
    const result = await vote()

    expect(result).toEqual({
      verdict: 'down',
      reasonKind: 'wrong_name',
      editApplied: true,
      editError: null,
      thought: EDITED_THOUGHT,
    })

    // the label request is built from what was stored NOW, before the edit
    expect(mocks.runCaptureReasonLabel).toHaveBeenCalledTimes(1)
    const labelCall = mocks.runCaptureReasonLabel.mock.calls[0][0] as {
      userId: string
      request: { state: string; questions: Record<string, { criteria: Record<string, string> }> }
    }
    expect(labelCall.userId).toBe('u1')
    expect(labelCall.request.state).toContain(RAW)
    expect(labelCall.request.state).toContain(`Eigen stored it as: ${SUMMARY}`)
    expect(labelCall.request.state).toContain(REASON)
    expect(Object.keys(labelCall.request.questions)).toEqual(['reason'])
    expect(Object.keys(labelCall.request.questions.reason.criteria)).toEqual([
      ...CAPTURE_REASON_KINDS,
    ])

    // the reason, as typed (trimmed), is the edit request
    expect(mocks.editStoredThought).toHaveBeenCalledWith('u1', ID, REASON)

    // label strictly before edit; summary read before the label
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]
    expect(order(mocks.loadCaptureAuditInput)).toBeLessThan(order(mocks.runCaptureReasonLabel))
    expect(order(mocks.runCaptureReasonLabel)).toBeLessThan(order(mocks.editStoredThought))
    expect(order(mocks.editStoredThought)).toBeLessThan(order(mocks.saveCaptureVote))

    // stored: verdict, place, encrypted reason, label, edit time
    expect(mocks.saveCaptureVote).toHaveBeenCalledTimes(1)
    const saved = savedVote()
    expect(saved).toMatchObject({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'down',
      place: 'mesh',
      reasonEncrypted: `enc(${REASON.length})`,
      reasonKind: 'wrong_name',
    })
    expect((saved.editAppliedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect(Object.values(saved)).not.toContain(REASON)
  })

  it('encrypts the reason with the tenant key, like thought text', async () => {
    await vote({ reason: `  ${REASON}  ` })
    expect(mocks.encryptTenantValue).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'capture_review',
      column: 'reason',
      plaintext: REASON,
    })
    expect(mocks.editStoredThought).toHaveBeenCalledWith('u1', ID, REASON)
  })

  it('keeps every kind Jev can name, and passes it through unchanged', async () => {
    for (const kind of CAPTURE_REASON_KINDS) {
      mocks.runCaptureReasonLabel.mockResolvedValueOnce({ kind, probability: 0.8 })
      const result = await vote()
      expect(result.reasonKind).toBe(kind)
    }
  })

  it('retries the label inside the ingest ladder and goes on when a later try works', async () => {
    mocks.runCaptureReasonLabel
      .mockRejectedValueOnce(new Error('502'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ kind: 'wrong_date', probability: 0.7 })

    const result = await vote()

    expect(mocks.runCaptureReasonLabel).toHaveBeenCalledTimes(3)
    expect(result.reasonKind).toBe('wrong_date')
    expect(mocks.editStoredThought).toHaveBeenCalledTimes(1)
  })

  it('reads the stored state once, however many times the label is retried', async () => {
    mocks.runCaptureReasonLabel
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce({ kind: 'other', probability: 0.5 })
    await vote()
    expect(mocks.loadCaptureAuditInput).toHaveBeenCalledTimes(1)
  })

  describe('when the label fails 4 times (the first try and exactly 3 retries)', () => {
    beforeEach(() => {
      mocks.runCaptureReasonLabel.mockRejectedValue(new Error('decision model down'))
    })

    it('throws an explicit label_failed error', async () => {
      const failure = await vote().catch((e: unknown) => e)
      expect(failure).toBeInstanceOf(CaptureVoteError)
      expect(failure).toMatchObject({ code: 'label_failed' })
      expect((failure as Error).message).toBe(
        'Eigen could not work out what kind of mistake you described after 4 tries, so nothing was saved. Send it again.',
      )
      expect(mocks.runCaptureReasonLabel).toHaveBeenCalledTimes(1 + INGEST_MAX_RETRIES)
    })

    it('stores NOTHING: no review, no job, no edit, no vote', async () => {
      await vote().catch(() => undefined)
      expect(mocks.createPendingCaptureReviewIfMissing).not.toHaveBeenCalled()
      expect(mocks.enqueueUserJob).not.toHaveBeenCalled()
      expect(mocks.editStoredThought).not.toHaveBeenCalled()
      expect(mocks.saveCaptureVote).not.toHaveBeenCalled()
      expect(mocks.encryptTenantValue).not.toHaveBeenCalled()
    })

    it('keeps the underlying failure on cause', async () => {
      const failure = (await vote().catch((e: unknown) => e)) as Error
      expect(String(failure.cause)).toContain('decision model down')
    })
  })

  it('treats a label outside the closed set as a failed try (and fails after 4)', async () => {
    mocks.runCaptureReasonLabel.mockResolvedValue({ kind: 'wrong_vibes', probability: 0.99 })
    await expect(vote()).rejects.toMatchObject({ code: 'label_failed' })
    expect(mocks.runCaptureReasonLabel).toHaveBeenCalledTimes(1 + INGEST_MAX_RETRIES)
    expect(mocks.saveCaptureVote).not.toHaveBeenCalled()
  })

  describe('when the edit fails', () => {
    beforeEach(() => {
      mocks.editStoredThought.mockRejectedValue(new Error('enrichment gateway timed out'))
    })

    it('stores verdict, reason and label anyway, with no edit time, and returns the edit error', async () => {
      const result = await vote()

      expect(result).toEqual({
        verdict: 'down',
        reasonKind: 'wrong_name',
        editApplied: false,
        editError: 'enrichment gateway timed out',
        thought: null,
      })
      const saved = savedVote()
      expect(saved).toMatchObject({
        verdict: 'down',
        reasonEncrypted: `enc(${REASON.length})`,
        reasonKind: 'wrong_name',
        editAppliedAt: null,
      })
    })
  })

  it('treats an edit that finds no thought as a missing thought and stores nothing', async () => {
    mocks.editStoredThought.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(vote()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.saveCaptureVote).not.toHaveBeenCalled()
  })

  it('lets a failed vote write surface (never swallowed), after the edit was applied', async () => {
    mocks.saveCaptureVote.mockRejectedValue(new Error('db down'))
    await expect(vote()).rejects.toThrow('db down')
    expect(mocks.editStoredThought).toHaveBeenCalledTimes(1)
  })
})

describe('voteOnCapture: the review row', () => {
  it('creates a pending review for a thought that has none and queues its audit', async () => {
    mocks.createPendingCaptureReviewIfMissing.mockResolvedValue('review-9')

    await vote({ verdict: 'up', reason: undefined })

    expect(mocks.createPendingCaptureReviewIfMissing).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: ID,
    })
    expect(mocks.enqueueUserJob).toHaveBeenCalledWith({
      userId: 'u1',
      jobType: CAPTURE_REVIEW_AUDIT_JOB,
      runAfter: expect.any(Date),
      payload: { thoughtId: ID },
      maxAttempts: CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS,
    })
    expect(mocks.createPendingCaptureReviewIfMissing.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveCaptureVote.mock.invocationCallOrder[0],
    )
  })

  it('leaves an existing review alone: no second audit job', async () => {
    mocks.createPendingCaptureReviewIfMissing.mockResolvedValue(null)
    await vote({ verdict: 'up', reason: undefined })
    expect(mocks.enqueueUserJob).not.toHaveBeenCalled()
  })

  it('creates it after the label and before the edit (so a failed label stores nothing)', async () => {
    mocks.createPendingCaptureReviewIfMissing.mockResolvedValue('review-9')
    await vote()
    const at = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]
    expect(at(mocks.runCaptureReasonLabel)).toBeLessThan(at(mocks.createPendingCaptureReviewIfMissing))
    expect(at(mocks.createPendingCaptureReviewIfMissing)).toBeLessThan(at(mocks.editStoredThought))
  })

  it.each([
    ['rejects', () => mocks.enqueueUserJob.mockRejectedValue(new Error('queue down'))],
    [
      'reports a duplicate',
      () => mocks.enqueueUserJob.mockResolvedValue({ enqueued: false, reason: 'duplicate' }),
    ],
  ])('removes the review it just created, stores nothing and edits nothing when the audit enqueue %s', async (_name, arrange) => {
    mocks.createPendingCaptureReviewIfMissing.mockResolvedValue('review-9')
    arrange()

    await expect(vote()).rejects.toThrow(/capture_review_audit job was not enqueued|queue down/)

    expect(mocks.deleteCaptureReview).toHaveBeenCalledWith({ userId: 'u1', reviewId: 'review-9' })
    expect(mocks.editStoredThought).not.toHaveBeenCalled()
    expect(mocks.saveCaptureVote).not.toHaveBeenCalled()
  })

  it('still reports the enqueue failure when removing the review fails too', async () => {
    mocks.createPendingCaptureReviewIfMissing.mockResolvedValue('review-9')
    mocks.enqueueUserJob.mockRejectedValue(new Error('queue down'))
    mocks.deleteCaptureReview.mockRejectedValue(new Error('delete failed'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(vote({ verdict: 'up', reason: undefined })).rejects.toThrow('queue down')
  })
})

describe('voteOnCapture: re-voting replaces the vote', () => {
  it('a thumbs-up after a thumbs-down writes the up vote and clears the reason fields', async () => {
    await vote()
    await vote({ verdict: 'up', reason: undefined, place: 'capture' })

    expect(mocks.saveCaptureVote).toHaveBeenCalledTimes(2)
    expect(savedVote(0)).toMatchObject({ verdict: 'down', reasonKind: 'wrong_name' })
    expect(savedVote(1)).toEqual({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'up',
      place: 'capture',
      reasonEncrypted: null,
      reasonKind: null,
    })
  })

  it('a second thumbs-down with a new reason writes the new label over the old', async () => {
    await vote()
    mocks.runCaptureReasonLabel.mockResolvedValueOnce({ kind: 'wrong_date', probability: 0.8 })
    await vote({ reason: 'the day is wrong' })

    expect(savedVote(1)).toMatchObject({ verdict: 'down', reasonKind: 'wrong_date' })
  })
})

describe('voteOnCapture: refusals', () => {
  it('a thought that does not exist (deleted, or another user’s under RLS) is a not_found error before anything else', async () => {
    mocks.loadVoteTarget.mockResolvedValue(null)

    const failure = await vote().catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(CaptureVoteError)
    expect(failure).toMatchObject({ code: 'not_found' })
    expect((failure as Error).message).toBe('Thought not found')
    expect(mocks.loadCaptureAuditInput).not.toHaveBeenCalled()
    expect(mocks.runCaptureReasonLabel).not.toHaveBeenCalled()
    expect(mocks.createPendingCaptureReviewIfMissing).not.toHaveBeenCalled()
    expect(mocks.editStoredThought).not.toHaveBeenCalled()
    expect(mocks.saveCaptureVote).not.toHaveBeenCalled()
  })

  it('a thought that vanishes while the summary is read is a not_found error too', async () => {
    mocks.loadCaptureAuditInput.mockResolvedValue(null)
    await expect(vote()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.runCaptureReasonLabel).not.toHaveBeenCalled()
  })

  it('rejects a reason over 2000 characters before any lookup', async () => {
    const failure = await vote({ reason: 'a'.repeat(2001) }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(CaptureVoteInputError)
    expect((failure as Error).message).toBe('reason must be at most 2000 characters')
    expect(mocks.loadVoteTarget).not.toHaveBeenCalled()
  })

  it('rejects a bad verdict, place or id before any lookup', async () => {
    await expect(vote({ verdict: 'maybe' as never })).rejects.toThrow('verdict must be up or down')
    await expect(vote({ place: 'yarn' as never })).rejects.toThrow('place must be capture, mesh or mcp')
    await expect(vote({ thoughtId: 'nope' })).rejects.toThrow('thoughtId must be a uuid')
    expect(mocks.loadVoteTarget).not.toHaveBeenCalled()
  })

  it('rejects a reason with a thumbs-up', async () => {
    await expect(vote({ verdict: 'up' })).rejects.toThrow('reason is only allowed with verdict down')
    expect(mocks.saveCaptureVote).not.toHaveBeenCalled()
  })
})

describe('voteOnCapture: logs', () => {
  it('writes nothing the user wrote — no reason, no capture text, no names — through any path', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    )

    await vote()
    mocks.editStoredThought.mockRejectedValueOnce(new Error('edit blew up'))
    await vote()
    mocks.runCaptureReasonLabel.mockRejectedValue(new Error('label blew up'))
    await vote().catch(() => undefined)
    mocks.createPendingCaptureReviewIfMissing.mockResolvedValue('review-9')
    mocks.enqueueUserJob.mockRejectedValue(new Error('queue blew up'))
    mocks.deleteCaptureReview.mockRejectedValue(new Error('cleanup blew up'))
    mocks.runCaptureReasonLabel.mockResolvedValue({ kind: 'other', probability: 0.5 })
    await vote().catch(() => undefined)

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
    for (const secret of [REASON, 'Greta', 'sister', 'Anna', RAW, 'tickets']) {
      expect(logged).not.toContain(secret)
    }
  })

  it('does log ids, the verdict and the kind (so a vote can be traced without its text)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await vote()
    const logged = JSON.stringify(info.mock.calls)
    expect(logged).toContain(ID)
    expect(logged).toContain('down')
    expect(logged).toContain('wrong_name')
  })
})
