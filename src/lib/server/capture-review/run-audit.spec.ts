import type { CaptureAuditInput } from './audit-questions'
import type { CaptureReviewPart } from './review-parts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionChoiceAnswer, DecisionRequest } from '$lib/server/llm/decision-client'

const mocks = vi.hoisted(() => ({
  loadCaptureReviewForAudit: vi.fn(),
  completeCaptureReviewAudit: vi.fn(),
  failCaptureReviewAudit: vi.fn(),
  loadCaptureAuditInput: vi.fn(),
  runCaptureAudit: vi.fn(),
}))

vi.mock('./review-store', () => ({
  loadCaptureReviewForAudit: mocks.loadCaptureReviewForAudit,
  completeCaptureReviewAudit: mocks.completeCaptureReviewAudit,
  failCaptureReviewAudit: mocks.failCaptureReviewAudit,
}))
vi.mock('./audit-input', () => ({ loadCaptureAuditInput: mocks.loadCaptureAuditInput }))
vi.mock('$lib/server/llm/decision-plane', () => ({ runCaptureAudit: mocks.runCaptureAudit }))

import { CaptureAuditError, runCaptureReviewAudit } from './run-audit'

const decisionPart: CaptureReviewPart = {
  part: 'category',
  ref: 'category',
  engine: 'jev_decision',
  label: 'task',
  probability: 0.55,
}

const auditInput: CaptureAuditInput = {
  capturedAt: '2026-11-04T09:15:00.000Z',
  timezone: 'Europe/Berlin',
  rawText: 'Dentist Friday at 9, ask Anna for a ride',
  storedText: 'Dentist Friday at 9, ask Anna for a ride',
  names: [{ ref: 'n1', surface: 'Anna' }],
  dates: [{ ref: 'd1', event: 'Dentist', day: '2026-11-06', detail: 'at 09:00' }],
  pieces: [],
}

function answer(choice: string, probabilities: Record<string, number>): DecisionChoiceAnswer {
  return { type: 'choice', choice, probabilities, confidence: probabilities[choice] ?? 0.5 }
}

/** Jev says everything is right with probability p, unless an override is given. */
function juryAnswers(p = 0.95, overrides: Record<string, DecisionChoiceAnswer> = {}) {
  return async ({ request }: { request: DecisionRequest }) => {
    const answers = new Map<string, DecisionChoiceAnswer>()
    for (const id of Object.keys(request.questions)) {
      const good = id === 'missing_names' ? 'none_missing' : 'right'
      const bad = id === 'missing_names' ? 'something_missing' : 'wrong'
      answers.set(id, overrides[id] ?? answer(good, { [good]: p, [bad]: 1 - p }))
    }
    return answers
  }
}

const run = (overrides: { attempt?: number; maxAttempts?: number } = {}) =>
  runCaptureReviewAudit({
    userId: 'u1',
    thoughtId: 't1',
    attempt: overrides.attempt ?? 1,
    maxAttempts: overrides.maxAttempts ?? 4,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  mocks.loadCaptureReviewForAudit.mockResolvedValue({
    status: 'pending_audit',
    parts: [decisionPart],
  })
  mocks.loadCaptureAuditInput.mockResolvedValue(auditInput)
  mocks.runCaptureAudit.mockImplementation(juryAnswers())
  mocks.completeCaptureReviewAudit.mockResolvedValue(true)
  mocks.failCaptureReviewAudit.mockResolvedValue(true)
})

describe('runCaptureReviewAudit: the audit', () => {
  it('asks Jev the audit questions of the stored capture and scores the review', async () => {
    await run()

    expect(mocks.loadCaptureAuditInput).toHaveBeenCalledWith({ userId: 'u1', thoughtId: 't1' })
    expect(mocks.runCaptureAudit).toHaveBeenCalledTimes(1)
    const call = mocks.runCaptureAudit.mock.calls[0][0] as {
      userId: string
      request: DecisionRequest
    }
    expect(call.userId).toBe('u1')
    expect(Object.keys(call.request.questions)).toEqual(['name:n1', 'missing_names', 'date:d1'])

    expect(mocks.completeCaptureReviewAudit).toHaveBeenCalledTimes(1)
    const done = mocks.completeCaptureReviewAudit.mock.calls[0][0] as {
      thoughtId: string
      expectedParts: CaptureReviewPart[]
      parts: CaptureReviewPart[]
      score: number
    }
    expect(done.thoughtId).toBe('t1')
    expect(done.expectedParts).toEqual([decisionPart])
    expect(done.parts).toEqual([
      decisionPart,
      { part: 'name', ref: 'name:n1', engine: 'jev_audit', label: 'right', probability: 0.95 },
      {
        part: 'missing_names',
        ref: 'missing_names',
        engine: 'jev_audit',
        label: 'none_missing',
        probability: 0.95,
      },
      { part: 'date', ref: 'date:d1', engine: 'jev_audit', label: 'right', probability: 0.95 },
    ])
    expect(mocks.failCaptureReviewAudit).not.toHaveBeenCalled()
  })

  it('scores the weakest part: a Jev decision part can be the weakest', async () => {
    await run()
    expect((mocks.completeCaptureReviewAudit.mock.calls[0][0] as { score: number }).score).toBe(
      0.55,
    )
  })

  it('scores the weakest part: an audit part can be the weakest (P of the good answer)', async () => {
    mocks.runCaptureAudit.mockImplementation(
      juryAnswers(0.95, { 'date:d1': answer('wrong', { right: 0.08, wrong: 0.92 }) }),
    )
    await run()
    expect((mocks.completeCaptureReviewAudit.mock.calls[0][0] as { score: number }).score).toBe(
      0.08,
    )
  })

  it('scores a review that has no Jev decision parts from the audit parts alone', async () => {
    mocks.loadCaptureReviewForAudit.mockResolvedValue({ status: 'pending_audit', parts: [] })
    await run()
    expect((mocks.completeCaptureReviewAudit.mock.calls[0][0] as { score: number }).score).toBe(
      0.95,
    )
  })

  it('writes parts that hold no thought text', async () => {
    await run()
    const written = JSON.stringify(mocks.completeCaptureReviewAudit.mock.calls)
    for (const text of ['Anna', 'Dentist', 'ride', 'Friday']) expect(written).not.toContain(text)
  })

  it('keeps only the Jev decision parts of the review when it builds the final parts', async () => {
    mocks.loadCaptureReviewForAudit.mockResolvedValue({
      status: 'pending_audit',
      parts: [
        decisionPart,
        { part: 'name', ref: 'name:n9', engine: 'jev_audit', label: 'right', probability: 0.99 },
      ],
    })
    await run()
    const parts = (
      mocks.completeCaptureReviewAudit.mock.calls[0][0] as { parts: CaptureReviewPart[] }
    ).parts
    expect(parts.filter((p) => p.ref === 'name:n9')).toEqual([])
  })

  it('does not fail when the review was replaced by a newer enrichment meanwhile (its own job scores it)', async () => {
    mocks.completeCaptureReviewAudit.mockResolvedValue(false)
    await expect(run()).resolves.toBeUndefined()
    expect(mocks.failCaptureReviewAudit).not.toHaveBeenCalled()
  })
})

describe('runCaptureReviewAudit: nothing to do', () => {
  it('does nothing for a review that is not pending (a duplicate job, or already scored)', async () => {
    for (const status of ['scored', 'audit_failed'] as const) {
      mocks.loadCaptureReviewForAudit.mockResolvedValue({ status, parts: [decisionPart] })
      await run()
    }
    expect(mocks.loadCaptureAuditInput).not.toHaveBeenCalled()
    expect(mocks.runCaptureAudit).not.toHaveBeenCalled()
  })

  it('does nothing when the thought was deleted (the review went with it)', async () => {
    mocks.loadCaptureReviewForAudit.mockResolvedValue(null)
    mocks.loadCaptureAuditInput.mockResolvedValue(null)
    await expect(run()).resolves.toBeUndefined()
    expect(mocks.runCaptureAudit).not.toHaveBeenCalled()
    expect(mocks.completeCaptureReviewAudit).not.toHaveBeenCalled()
    expect(mocks.failCaptureReviewAudit).not.toHaveBeenCalled()
  })

  it('does nothing when the thought is deleted between reading the review and the thought', async () => {
    mocks.loadCaptureAuditInput.mockResolvedValue(null)
    await expect(run()).resolves.toBeUndefined()
    expect(mocks.runCaptureAudit).not.toHaveBeenCalled()
  })

  it('still audits an archived thought (the audit does not look at the lifecycle)', async () => {
    await run()
    expect(mocks.runCaptureAudit).toHaveBeenCalledTimes(1)
  })

  it('fails loudly when the thought exists but has no review', async () => {
    mocks.loadCaptureReviewForAudit.mockResolvedValue(null)
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CaptureAuditError)
    expect(((error as Error).cause as Error).message).toMatch(/review is missing/)
    expect(mocks.runCaptureAudit).not.toHaveBeenCalled()
  })
})

describe('runCaptureReviewAudit: failures and giving up', () => {
  it('rethrows a failure on a non-final attempt without touching the review (the queue retries)', async () => {
    mocks.runCaptureAudit.mockRejectedValue(new Error('502 bad gateway'))

    await expect(run({ attempt: 2, maxAttempts: 4 })).rejects.toBeInstanceOf(CaptureAuditError)

    expect(mocks.failCaptureReviewAudit).not.toHaveBeenCalled()
    expect(mocks.completeCaptureReviewAudit).not.toHaveBeenCalled()
  })

  it('marks the review audit_failed on the final attempt, then rethrows so the queue gives up', async () => {
    mocks.runCaptureAudit.mockRejectedValue(new Error('502 bad gateway'))

    await expect(run({ attempt: 4, maxAttempts: 4 })).rejects.toBeInstanceOf(CaptureAuditError)

    expect(mocks.failCaptureReviewAudit).toHaveBeenCalledTimes(1)
    expect(mocks.failCaptureReviewAudit).toHaveBeenCalledWith({
      thoughtId: 't1',
      auditError: expect.stringContaining('4 attempts'),
      expectedParts: [decisionPart],
    })
  })

  it('names the failing step in the audit_failed explanation, from a closed set', async () => {
    mocks.runCaptureAudit.mockRejectedValue(new Error('502 bad gateway'))
    await expect(run({ attempt: 4 })).rejects.toThrow()
    expect(mocks.failCaptureReviewAudit.mock.calls[0][0].auditError).toMatch(
      /step "decision_model"/,
    )

    mocks.failCaptureReviewAudit.mockClear()
    mocks.loadCaptureAuditInput.mockRejectedValue(new Error('unsupported recurrence'))
    await expect(run({ attempt: 4 })).rejects.toThrow()
    expect(mocks.failCaptureReviewAudit.mock.calls[0][0].auditError).toMatch(
      /step "reading_capture"/,
    )

    mocks.failCaptureReviewAudit.mockClear()
    mocks.loadCaptureAuditInput.mockResolvedValue(auditInput)
    mocks.runCaptureAudit.mockImplementation(juryAnswers())
    mocks.completeCaptureReviewAudit.mockRejectedValue(new Error('db down'))
    await expect(run({ attempt: 4 })).rejects.toThrow()
    expect(mocks.failCaptureReviewAudit.mock.calls[0][0].auditError).toMatch(/step "saving_result"/)
  })

  it('puts no user text in the audit_failed explanation or in the error the queue sees', async () => {
    // The underlying errors can quote anything; the stored explanation must not.
    mocks.runCaptureAudit.mockRejectedValue(
      new Error('model said: Dentist Friday at 9, ask Anna for a ride'),
    )

    const error = await run({ attempt: 4 }).catch((e: unknown) => e)

    const stored = mocks.failCaptureReviewAudit.mock.calls[0][0].auditError as string
    for (const text of ['Anna', 'Dentist', 'ride', 'Friday', 'model said']) {
      expect(stored).not.toContain(text)
      expect(String((error as Error).message)).not.toContain(text)
    }
    // The cause stays on the error for the server log.
    expect(((error as Error).cause as Error).message).toContain('Anna')
  })

  it('fails the step "reading_capture" when the audit request cannot be built from the stored capture', async () => {
    mocks.loadCaptureAuditInput.mockResolvedValue({ ...auditInput, rawText: '  ' })
    await expect(run({ attempt: 4 })).rejects.toBeInstanceOf(CaptureAuditError)
    expect(mocks.runCaptureAudit).not.toHaveBeenCalled()
    expect(mocks.failCaptureReviewAudit.mock.calls[0][0].auditError).toMatch(
      /step "reading_capture"/,
    )
  })

  it('fails the step "scoring" when the answers cannot be turned into parts (a question left unanswered)', async () => {
    mocks.runCaptureAudit.mockImplementation(async () => new Map<string, DecisionChoiceAnswer>())
    await expect(run({ attempt: 4 })).rejects.toBeInstanceOf(CaptureAuditError)
    expect(mocks.failCaptureReviewAudit.mock.calls[0][0].auditError).toMatch(/step "scoring"/)
  })

  it('does not mask the original failure when marking the review failed also fails', async () => {
    mocks.runCaptureAudit.mockRejectedValue(new Error('502 bad gateway'))
    mocks.failCaptureReviewAudit.mockRejectedValue(new Error('db down'))

    const error = await run({ attempt: 4 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CaptureAuditError)
    expect(((error as Error).cause as Error).message).toContain('502')
    expect(console.error).toHaveBeenCalled()
  })

  it('still fails loudly when the final failure was a missing decision-model config', async () => {
    mocks.runCaptureAudit.mockRejectedValue(
      new Error('[decision-plane] capture audit requires DECISION_SHADOW_ENABLED=true'),
    )
    await expect(run({ attempt: 4 })).rejects.toBeInstanceOf(CaptureAuditError)
    expect(mocks.failCaptureReviewAudit).toHaveBeenCalledTimes(1)
  })

  it('names itself in the server log for every failed attempt, with the underlying message', async () => {
    mocks.runCaptureAudit.mockRejectedValue(new Error('502 bad gateway'))
    await expect(run({ attempt: 2 })).rejects.toThrow()
    expect(console.error).toHaveBeenCalledWith(
      '[capture-review] audit attempt failed',
      expect.objectContaining({
        thoughtId: 't1',
        attempt: 2,
        maxAttempts: 4,
        step: 'decision_model',
      }),
    )
  })
})
