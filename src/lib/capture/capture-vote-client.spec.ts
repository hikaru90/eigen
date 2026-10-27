import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postCaptureVote } from './capture-vote-client'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const stored = {
  verdict: 'down',
  reasonKind: 'wrong_name',
  editApplied: true,
  changed: true,
  editError: null,
  thought: { id: 't1', normalizedText: 'Call Greta', category: 'task' },
}

describe('postCaptureVote', () => {
  it('posts the vote to the vote endpoint with the session, and returns what the server stored', async () => {
    fetchMock.mockResolvedValue(reply(stored))

    const result = await postCaptureVote({
      thoughtId: 't1',
      verdict: 'down',
      reason: 'it is Greta',
      place: 'mesh',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/capture/review/vote')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      thoughtId: 't1',
      verdict: 'down',
      reason: 'it is Greta',
      place: 'mesh',
    })
    expect(result).toEqual(stored)
  })

  it('leaves the reason out of a thumbs-up and of an empty thumbs-down', async () => {
    fetchMock.mockResolvedValue(
      reply({ verdict: 'up', reasonKind: null, editApplied: false, changed: false, editError: null, thought: null }),
    )
    await postCaptureVote({ thoughtId: 't1', verdict: 'up', place: 'capture' })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      thoughtId: 't1',
      verdict: 'up',
      place: 'capture',
    })
  })

  it('throws the server’s own message when the vote is refused', async () => {
    fetchMock.mockResolvedValue(
      reply({ message: 'Eigen could not work out what kind of mistake you described' }, 502),
    )
    await expect(
      postCaptureVote({ thoughtId: 't1', verdict: 'down', reason: 'x', place: 'capture' }),
    ).rejects.toThrow('Eigen could not work out what kind of mistake you described')
  })

  it('throws a plain failure with the status when the body says nothing', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    await expect(
      postCaptureVote({ thoughtId: 't1', verdict: 'up', place: 'capture' }),
    ).rejects.toThrow('Vote failed (500)')
  })

  it('throws when the server answers something that is not a stored vote', async () => {
    fetchMock.mockResolvedValue(reply({ verdict: 'maybe' }))
    await expect(
      postCaptureVote({ thoughtId: 't1', verdict: 'up', place: 'capture' }),
    ).rejects.toThrow('Vote answer was not understood')
    fetchMock.mockResolvedValue(reply({ verdict: 'up', editApplied: 'yes' }))
    await expect(
      postCaptureVote({ thoughtId: 't1', verdict: 'up', place: 'capture' }),
    ).rejects.toThrow('Vote answer was not understood')
  })

  it('does not swallow a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      postCaptureVote({ thoughtId: 't1', verdict: 'up', place: 'capture' }),
    ).rejects.toThrow('Failed to fetch')
  })
})
