import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoardRequestError,
  checkIdea,
  correctIdea,
  fetchBoard,
  forgetIdea,
  shareIdea,
  voteOnIdea,
} from './board-client'

function respond(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('board client (explicit +server endpoints, errors surface verbatim)', () => {
  it('loads the board', async () => {
    const f = respond(200, { ideas: [{ id: 'a' }] })
    vi.stubGlobal('fetch', f)
    expect(await fetchBoard()).toEqual([{ id: 'a' }])
    expect(f).toHaveBeenCalledWith('/api/board', expect.objectContaining({ method: 'GET' }))
  })

  it('sends the judge check, the share, the vote, the correction and the forget to their endpoints', async () => {
    const f = respond(200, { ok: true })
    vi.stubGlobal('fetch', f)
    await checkIdea('Dark mode')
    await shareIdea({ title: 'Dark mode', kind: 'idea', area: 'yarn' })
    await voteOnIdea('id1', -1)
    await correctIdea('id1', { kind: 'bug' })
    await forgetIdea('id1')
    const calls = f.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'POST /api/board/ideas/check',
      'POST /api/board/ideas',
      'PUT /api/board/ideas/id1/vote',
      'PATCH /api/board/ideas/id1',
      'DELETE /api/board/ideas/id1',
    ])
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ direction: -1 })
  })

  it('throws the server’s error message and status', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'This idea has shipped — votes are closed' }))
    await expect(voteOnIdea('id1', 1)).rejects.toMatchObject({
      status: 409,
      message: 'This idea has shipped — votes are closed',
    })
    vi.stubGlobal(
      'fetch',
      respond(402, { error: 'Insufficient credits', code: 'insufficient_credits' }),
    )
    const err = await checkIdea('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BoardRequestError)
    expect((err as BoardRequestError).code).toBe('insufficient_credits')
  })
})
