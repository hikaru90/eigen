import { beforeEach, describe, expect, it, vi } from 'vitest'

const { voteOnCaptureMock } = vi.hoisted(() => ({ voteOnCaptureMock: vi.fn() }))
vi.mock('$lib/server/capture-review/vote', () => ({ voteOnCapture: voteOnCaptureMock }))

import { CaptureVoteError } from '$lib/server/capture-review/vote-error'
import { POST } from './+server'

const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'

function call(body: unknown, user: { id: string } | null = { id: 'u1' }) {
  return POST({
    locals: { user },
    request: { json: vi.fn(async () => body) },
  } as never)
}

async function refusal(body: unknown): Promise<{ status: number; message: string }> {
  try {
    await call(body)
  } catch (err) {
    const e = err as { status: number; body: { message: string } }
    return { status: e.status, message: e.body.message }
  }
  throw new Error('expected the request to be refused')
}

const stored = {
  verdict: 'down',
  reasonKind: 'wrong_name',
  editApplied: true,
  editError: null,
  thought: { id: ID, normalizedText: 'Call my sister Greta', category: 'task' },
}

beforeEach(() => {
  voteOnCaptureMock.mockReset()
  voteOnCaptureMock.mockResolvedValue(stored)
})

describe('POST /api/capture/review/vote', () => {
  it('requires a user', async () => {
    await expect(call({ thoughtId: ID, verdict: 'up', place: 'capture' }, null)).rejects.toMatchObject({
      status: 401,
    })
    expect(voteOnCaptureMock).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: { json: vi.fn(async () => Promise.reject(new Error('bad'))) },
      } as never),
    ).rejects.toMatchObject({ status: 400, body: { message: 'Invalid JSON' } })
  })

  describe('validates at the boundary, with exact messages, before any work', () => {
    const ok = { thoughtId: ID, verdict: 'up', place: 'capture' }

    it.each([
      ['body must be a JSON object', null],
      ['thoughtId must be a uuid', { ...ok, thoughtId: 'abc' }],
      ['verdict must be up or down', { ...ok, verdict: 'maybe' }],
      ['place must be capture or mesh', { ...ok, place: 'yarn' }],
      ['reason must be a string', { ...ok, verdict: 'down', reason: 4 }],
      ['reason must be at most 2000 characters', { ...ok, verdict: 'down', reason: 'x'.repeat(2001) }],
      ['reason is only allowed with verdict down', { ...ok, reason: 'because' }],
    ])('400 "%s"', async (message, body) => {
      expect(await refusal(body)).toEqual({ status: 400, message })
      expect(voteOnCaptureMock).not.toHaveBeenCalled()
    })
  })

  it('votes for the signed-in user and answers the stored vote with the edited thought', async () => {
    const res = await call({
      thoughtId: ID,
      verdict: 'down',
      place: 'mesh',
      reason: '  it is Greta  ',
    })

    expect(voteOnCaptureMock).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'down',
      place: 'mesh',
      reason: 'it is Greta',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(stored)
  })

  it('answers a thumbs-up with no thought and no edit', async () => {
    voteOnCaptureMock.mockResolvedValue({
      verdict: 'up',
      reasonKind: null,
      editApplied: false,
      editError: null,
      thought: null,
    })
    const res = await call({ thoughtId: ID, verdict: 'up', place: 'capture' })
    expect(voteOnCaptureMock).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: ID,
      verdict: 'up',
      place: 'capture',
      reason: undefined,
    })
    expect(await res.json()).toEqual({
      verdict: 'up',
      reasonKind: null,
      editApplied: false,
      editError: null,
      thought: null,
    })
  })

  it('answers an edit that failed explicitly: the vote is stored, the error is returned (200, not swallowed)', async () => {
    voteOnCaptureMock.mockResolvedValue({
      verdict: 'down',
      reasonKind: 'wrong_date',
      editApplied: false,
      editError: 'enrichment gateway timed out',
      thought: null,
    })
    const res = await call({ thoughtId: ID, verdict: 'down', place: 'capture', reason: 'wrong day' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      editApplied: false,
      editError: 'enrichment gateway timed out',
      reasonKind: 'wrong_date',
    })
  })

  it('404 when the thought is not there', async () => {
    voteOnCaptureMock.mockRejectedValue(new CaptureVoteError('not_found', 'Thought not found'))
    expect(await refusal({ thoughtId: ID, verdict: 'up', place: 'capture' })).toEqual({
      status: 404,
      message: 'Thought not found',
    })
  })

  it('502 with the explicit message when the kind-of-mistake label could not be made', async () => {
    const message =
      'Eigen could not work out what kind of mistake you described after 4 tries, so nothing was saved. Send it again.'
    voteOnCaptureMock.mockRejectedValue(new CaptureVoteError('label_failed', message))
    expect(
      await refusal({ thoughtId: ID, verdict: 'down', place: 'capture', reason: 'it is Greta' }),
    ).toEqual({ status: 502, message })
  })

  it('500 with the message for any other failure, and logs ids only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    voteOnCaptureMock.mockRejectedValue(new Error('db down'))

    expect(
      await refusal({ thoughtId: ID, verdict: 'down', place: 'mesh', reason: 'secret words here' }),
    ).toEqual({ status: 500, message: 'db down' })

    const logged = JSON.stringify(error.mock.calls)
    expect(logged).toContain(ID)
    expect(logged).not.toContain('secret words here')
    error.mockRestore()
  })
})
