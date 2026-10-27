import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCaptureReviewView: vi.fn(),
  voteOnCapture: vi.fn(),
}))

vi.mock('$lib/server/capture-review/review-view', () => ({
  getCaptureReviewView: mocks.getCaptureReviewView,
}))
vi.mock('$lib/server/capture-review/vote', () => ({ voteOnCapture: mocks.voteOnCapture }))

import { CaptureVoteError } from '$lib/server/capture-review/vote-error'
import { runGetCaptureReviewTool, runRateCaptureTool } from './capture-review-tools'

const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'
const CONTEXT = { userId: 'u1' }
const REASON = 'it is about my sister Greta, not Anna'
const EDITED_WORDS = 'Call my sister Greta on Friday'

const VIEW = {
  thought_id: ID,
  status: 'scored',
  score: 0.62,
  threshold: 0.7,
  below_threshold: true,
  parts: [],
  vote: null,
  note: null,
}

const EDITED_THOUGHT = {
  id: ID,
  normalizedText: EDITED_WORDS,
  category: 'task',
  metadata: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCaptureReviewView.mockResolvedValue(VIEW)
  mocks.voteOnCapture.mockResolvedValue({
    verdict: 'up',
    reasonKind: null,
    editApplied: false,
    editError: null,
    thought: null,
  })
})

async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected the tool to fail')
}

describe('get_capture_review: arguments are checked before any DB work', () => {
  it.each([
    [null, 'Arguments must be a JSON object'],
    ['x', 'Arguments must be a JSON object'],
    [['a'], 'Arguments must be a JSON object'],
    [{}, 'thought_id must be a uuid'],
    [{ thought_id: '' }, 'thought_id must be a uuid'],
    [{ thought_id: 'not-a-uuid' }, 'thought_id must be a uuid'],
    [{ thought_id: 7 }, 'thought_id must be a uuid'],
    [{ thought_id: ` ${ID}` }, 'thought_id must be a uuid'],
    [{ thought_id: ID, extra: 1 }, 'Unknown argument: extra. Allowed: thought_id'],
    [{ thoughtId: ID }, 'Unknown argument: thoughtId. Allowed: thought_id'],
    [{ id: ID }, 'Unknown argument: id. Allowed: thought_id'],
  ])('%j fails with %s', async (args, message) => {
    expect(await messageOf(() => runGetCaptureReviewTool(CONTEXT, args))).toBe(message)
    expect(mocks.getCaptureReviewView).not.toHaveBeenCalled()
  })
})

describe('get_capture_review: result', () => {
  it('reads the review of this user’s thought and returns the view as it is', async () => {
    const out = await runGetCaptureReviewTool(CONTEXT, { thought_id: ID })
    expect(mocks.getCaptureReviewView).toHaveBeenCalledWith({ userId: 'u1', thoughtId: ID })
    expect(out).toEqual(VIEW)
  })

  it('passes the result through the MCP sanitizer: no embedding can ride along', async () => {
    mocks.getCaptureReviewView.mockResolvedValue({
      ...VIEW,
      embedding: Array.from({ length: 1536 }, () => 0.1),
      thought_embedding: [0.1],
    })
    const out = (await runGetCaptureReviewTool(CONTEXT, { thought_id: ID })) as Record<
      string,
      unknown
    >
    expect(Object.keys(out)).not.toContain('embedding')
    expect(Object.keys(out)).not.toContain('thought_embedding')
  })

  it('an unknown or foreign thought is an explicit not-found error', async () => {
    mocks.getCaptureReviewView.mockRejectedValue(
      new CaptureVoteError('not_found', 'Thought not found'),
    )
    expect(await messageOf(() => runGetCaptureReviewTool(CONTEXT, { thought_id: ID }))).toBe(
      'Thought not found',
    )
  })
})

describe('rate_capture: arguments are checked before any DB or Jev work (exact messages)', () => {
  it.each([
    [null, 'Arguments must be a JSON object'],
    [[], 'Arguments must be a JSON object'],
    [{ verdict: 'up' }, 'thought_id must be a uuid'],
    [{ thought_id: 'abc', verdict: 'up' }, 'thought_id must be a uuid'],
    [{ thought_id: ID }, 'verdict must be up or down'],
    [{ thought_id: ID, verdict: 'maybe' }, 'verdict must be up or down'],
    [{ thought_id: ID, verdict: 'UP' }, 'verdict must be up or down'],
    [{ thought_id: ID, verdict: 1 }, 'verdict must be up or down'],
    [{ thought_id: ID, verdict: null }, 'verdict must be up or down'],
    [{ thought_id: ID, verdict: 'up', reason: 'but' }, 'reason is only allowed with verdict down'],
    [{ thought_id: ID, verdict: 'down', reason: 5 }, 'reason must be a string'],
    [
      { thought_id: ID, verdict: 'down', reason: 'a'.repeat(2001) },
      'reason must be at most 2000 characters',
    ],
    [
      { thought_id: ID, verdict: 'up', place: 'mesh' },
      'Unknown argument: place. Allowed: thought_id, verdict, reason',
    ],
    [
      { thoughtId: ID, verdict: 'up' },
      'Unknown argument: thoughtId. Allowed: thought_id, verdict, reason',
    ],
  ])('%j fails with %s', async (args, message) => {
    expect(await messageOf(() => runRateCaptureTool(CONTEXT, args))).toBe(message)
    expect(mocks.voteOnCapture).not.toHaveBeenCalled()
  })

  it('checks thought_id, then verdict, then reason', async () => {
    expect(
      await messageOf(() => runRateCaptureTool(CONTEXT, { verdict: 'maybe', reason: 5 })),
    ).toBe('thought_id must be a uuid')
    expect(
      await messageOf(() =>
        runRateCaptureTool(CONTEXT, { thought_id: ID, verdict: 'maybe', reason: 5 }),
      ),
    ).toBe('verdict must be up or down')
  })

  it('accepts a reason of exactly 2000 characters', async () => {
    mocks.voteOnCapture.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'other',
      editApplied: true,
      editError: null,
      thought: EDITED_THOUGHT,
    })
    await runRateCaptureTool(CONTEXT, { thought_id: ID, verdict: 'down', reason: 'a'.repeat(2000) })
    expect(mocks.voteOnCapture).toHaveBeenCalledTimes(1)
  })
})

describe('rate_capture: the vote', () => {
  it('a thumbs-up is a verdict from an agent over MCP, nothing else', async () => {
    const out = await runRateCaptureTool(CONTEXT, { thought_id: ID, verdict: 'up' })
    expect(mocks.voteOnCapture).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'up',
      place: 'mcp',
      reason: undefined,
    })
    expect(out).toEqual({ verdict: 'up', reason_kind: null, edit_applied: false, edit_error: null })
  })

  it.each([undefined, '', '   ', '\n'])(
    'a thumbs-down with reason %j means no reason: verdict only',
    async (reason) => {
      mocks.voteOnCapture.mockResolvedValue({
        verdict: 'down',
        reasonKind: null,
        editApplied: false,
        editError: null,
        thought: null,
      })
      const out = await runRateCaptureTool(CONTEXT, { thought_id: ID, verdict: 'down', reason })
      expect(mocks.voteOnCapture).toHaveBeenCalledWith(
        expect.objectContaining({ verdict: 'down', place: 'mcp', reason: undefined }),
      )
      expect(out).toEqual({
        verdict: 'down',
        reason_kind: null,
        edit_applied: false,
        edit_error: null,
      })
    },
  )

  it('a thumbs-down with a reason returns the label, that the edit ran and the edited thought', async () => {
    mocks.voteOnCapture.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'wrong_name',
      editApplied: true,
      editError: null,
      thought: EDITED_THOUGHT,
    })
    const out = await runRateCaptureTool(CONTEXT, {
      thought_id: ID,
      verdict: 'down',
      reason: `  ${REASON}  `,
    })
    expect(mocks.voteOnCapture).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'down',
      place: 'mcp',
      reason: REASON,
    })
    expect(out).toEqual({
      verdict: 'down',
      reason_kind: 'wrong_name',
      edit_applied: true,
      edit_error: null,
      thought: EDITED_THOUGHT,
    })
  })

  it('a failed edit is reported, not swallowed: edit_applied false, the error, no thought', async () => {
    mocks.voteOnCapture.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'wrong_name',
      editApplied: false,
      editError: 'the edit model did not answer',
      thought: null,
    })
    const out = (await runRateCaptureTool(CONTEXT, {
      thought_id: ID,
      verdict: 'down',
      reason: REASON,
    })) as Record<string, unknown>
    expect(out).toEqual({
      verdict: 'down',
      reason_kind: 'wrong_name',
      edit_applied: false,
      edit_error: 'the edit model did not answer',
    })
    expect(Object.keys(out)).not.toContain('thought')
  })

  it('a label that cannot be made fails the call with Eigen’s sentence; nothing is returned', async () => {
    const sentence =
      'Eigen could not work out what kind of mistake you described after 4 tries, so nothing was saved. Send it again.'
    mocks.voteOnCapture.mockRejectedValue(new CaptureVoteError('label_failed', sentence))
    expect(
      await messageOf(() =>
        runRateCaptureTool(CONTEXT, { thought_id: ID, verdict: 'down', reason: REASON }),
      ),
    ).toBe(sentence)
  })

  it('an unknown or foreign thought is an explicit not-found error', async () => {
    mocks.voteOnCapture.mockRejectedValue(new CaptureVoteError('not_found', 'Thought not found'))
    expect(
      await messageOf(() => runRateCaptureTool(CONTEXT, { thought_id: ID, verdict: 'up' })),
    ).toBe('Thought not found')
  })

  it('never returns the reason text — only the label — and strips embeddings from the edited thought', async () => {
    mocks.voteOnCapture.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'wrong_name',
      editApplied: true,
      editError: null,
      thought: { ...EDITED_THOUGHT, embedding: Array.from({ length: 1536 }, () => 0.2) },
    })
    const out = await runRateCaptureTool(CONTEXT, {
      thought_id: ID,
      verdict: 'down',
      reason: REASON,
    })
    const json = JSON.stringify(out)
    expect(json).not.toContain(REASON)
    expect(json).not.toContain('"embedding"')
    expect(json).toContain(EDITED_WORDS)
  })
})
