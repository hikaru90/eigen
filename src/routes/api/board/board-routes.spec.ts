import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardError } from '$lib/server/board/errors'
import { GET } from './+server'
import { POST as CREATE } from './ideas/+server'
import { DELETE, PATCH } from './ideas/[id]/+server'
import { PUT as VOTE } from './ideas/[id]/vote/+server'
import { POST as CHECK } from './ideas/check/+server'

const m = vi.hoisted(() => ({
  listBoardIdeas: vi.fn(),
  setBoardVote: vi.fn(),
  correctBoardIdea: vi.fn(),
  deleteBoardIdea: vi.fn(),
  adminEditBoardIdea: vi.fn(async () => ({ reward: null })),
  adminDeleteBoardIdea: vi.fn(),
  getBoardIdea: vi.fn(),
  checkBoardIdea: vi.fn(),
  shareBoardIdea: vi.fn(),
  isUserAdmin: vi.fn(),
}))

vi.mock('$lib/server/board/service', () => ({
  listBoardIdeas: m.listBoardIdeas,
  setBoardVote: m.setBoardVote,
  correctBoardIdea: m.correctBoardIdea,
  deleteBoardIdea: m.deleteBoardIdea,
  adminDeleteBoardIdea: m.adminDeleteBoardIdea,
  getBoardIdea: m.getBoardIdea,
}))
vi.mock('$lib/server/board/share', () => ({
  adminEditBoardIdea: m.adminEditBoardIdea,
  checkBoardIdea: m.checkBoardIdea,
  shareBoardIdea: m.shareBoardIdea,
}))
vi.mock('$lib/server/auth/user-role', () => ({ isUserAdmin: m.isUserAdmin }))

const ID = '11111111-1111-4111-8111-111111111111'

/** A minimal RequestEvent; `never` lets one shape stand in for every route's event type. */
function ev(
  opts: { user?: { id: string } | null; body?: unknown; id?: string; method?: string } = {},
): never {
  return {
    locals: { user: opts.user === undefined ? { id: 'ub', email: 'b@example.com' } : opts.user },
    params: { id: opts.id ?? ID },
    request: new Request('http://localhost/api/board', {
      method: opts.method ?? 'POST',
      headers: { 'content-type': 'application/json' },
      ...(opts.body === undefined
        ? {}
        : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    }),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  m.isUserAdmin.mockResolvedValue(false)
})

describe('board routes', () => {
  it('require a signed-in user everywhere (401)', async () => {
    for (const res of [
      await GET(ev({ user: null, method: 'GET' })),
      await CHECK(ev({ user: null, body: { title: 'x' } })),
      await CREATE(ev({ user: null, body: { title: 'x', kind: 'idea', area: 'yarn' } })),
      await VOTE(ev({ user: null, body: { direction: 1 }, method: 'PUT' })),
      await PATCH(ev({ user: null, body: { kind: 'bug' }, method: 'PATCH' })),
      await DELETE(ev({ user: null, method: 'DELETE' })),
    ]) {
      expect(res.status).toBe(401)
    }
  })

  it('GET /api/board lists the board for the caller', async () => {
    m.listBoardIdeas.mockResolvedValue([{ id: ID, title: 't' }])
    const res = await GET(ev({ method: 'GET' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ideas: [{ id: ID, title: 't' }] })
    expect(m.listBoardIdeas).toHaveBeenCalledWith('ub')
  })

  it('PUT vote rejects direction 2 with the exact constraint', async () => {
    const res = await VOTE(ev({ body: { direction: 2 }, method: 'PUT' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid direction: 2. Must be -1, 0 or 1')
    expect(m.setBoardVote).not.toHaveBeenCalled()
  })

  it('PUT vote rejects a malformed idea id before any DB work', async () => {
    const res = await VOTE(ev({ id: 'fx-r1', body: { direction: 1 }, method: 'PUT' }))
    expect(res.status).toBe(400)
    expect(m.setBoardVote).not.toHaveBeenCalled()
  })

  it('PUT vote returns the new score; AC-6 shipped maps to 409', async () => {
    m.setBoardVote.mockResolvedValueOnce({ score: 5, myVote: 1 })
    const ok = await VOTE(ev({ body: { direction: 1 }, method: 'PUT' }))
    expect(await ok.json()).toEqual({ score: 5, myVote: 1 })
    m.setBoardVote.mockRejectedValueOnce(
      new BoardError('This idea has shipped — votes are closed', 409),
    )
    const shipped = await VOTE(ev({ body: { direction: 1 }, method: 'PUT' }))
    expect(shipped.status).toBe(409)
  })

  it('AC-7: a non-admin PATCHing status gets 403 and nothing runs', async () => {
    const res = await PATCH(ev({ body: { status: 'shipped' }, method: 'PATCH' }))
    expect(res.status).toBe(403)
    expect(m.adminEditBoardIdea).not.toHaveBeenCalled()
  })

  it('an admin PATCH goes through the admin path', async () => {
    m.isUserAdmin.mockResolvedValue(true)
    m.getBoardIdea.mockResolvedValue({ id: ID, status: 'shipped' })
    const res = await PATCH(ev({ body: { status: 'shipped', note: 'Out now' }, method: 'PATCH' }))
    expect(res.status).toBe(200)
    expect(m.adminEditBoardIdea).toHaveBeenCalledWith('ub', ID, {
      status: 'shipped',
      note: 'Out now',
    })
  })

  it('a non-admin PATCHing a title gets 403 and nothing runs', async () => {
    const res = await PATCH(ev({ body: { title: 'Better words' }, method: 'PATCH' }))
    expect(res.status).toBe(403)
    expect(m.adminEditBoardIdea).not.toHaveBeenCalled()
  })

  it('an admin edits the title through the admin path', async () => {
    m.isUserAdmin.mockResolvedValue(true)
    m.getBoardIdea.mockResolvedValue({ id: ID, title: 'Better words' })
    const res = await PATCH(ev({ body: { title: '  Better words ' }, method: 'PATCH' }))
    expect(res.status).toBe(200)
    expect(m.adminEditBoardIdea).toHaveBeenCalledWith('ub', ID, { title: 'Better words' })
  })

  it('an admin DELETE removes any idea through the admin path, never the author path', async () => {
    m.isUserAdmin.mockResolvedValue(true)
    expect((await DELETE(ev({ method: 'DELETE' }))).status).toBe(200)
    expect(m.adminDeleteBoardIdea).toHaveBeenCalledWith(ID)
    expect(m.deleteBoardIdea).not.toHaveBeenCalled()
  })

  it('AC-13: the author corrects kind/area through PATCH', async () => {
    m.getBoardIdea.mockResolvedValue({ id: ID, kind: 'bug' })
    const res = await PATCH(ev({ body: { kind: 'bug', area: 'capture' }, method: 'PATCH' }))
    expect(res.status).toBe(200)
    expect(m.correctBoardIdea).toHaveBeenCalledWith('ub', ID, { kind: 'bug', area: 'capture' })
  })

  it('DELETE maps author/status refusals to 403/409', async () => {
    m.deleteBoardIdea.mockRejectedValueOnce(
      new BoardError('Only the author can forget this idea', 403),
    )
    expect((await DELETE(ev({ method: 'DELETE' }))).status).toBe(403)
    m.deleteBoardIdea.mockRejectedValueOnce(
      new BoardError('Only Requested ideas can be forgotten', 409),
    )
    expect((await DELETE(ev({ method: 'DELETE' }))).status).toBe(409)
    m.deleteBoardIdea.mockResolvedValueOnce(undefined)
    expect((await DELETE(ev({ method: 'DELETE' }))).status).toBe(200)
  })

  it('POST check returns the judge result; insufficient credits is 402', async () => {
    m.checkBoardIdea.mockResolvedValueOnce({ kind: 'bug', area: 'capture', duplicateOf: null })
    const ok = await CHECK(ev({ body: { title: 'Voice capture cuts off' } }))
    expect(await ok.json()).toEqual({ kind: 'bug', area: 'capture', duplicateOf: null })
    m.checkBoardIdea.mockRejectedValueOnce(
      Object.assign(new Error('Insufficient credits'), {
        name: 'InsufficientCreditsError',
        availableCredits: 0,
      }),
    )
    const broke = await CHECK(ev({ body: { title: 'x' } }))
    expect(broke.status).toBe(402)
    expect((await broke.json()).code).toBe('insufficient_credits')
  })

  it('AC-16: POST check surfaces the judge failure as an explicit error', async () => {
    m.checkBoardIdea.mockRejectedValueOnce(
      new BoardError("Couldn't check your idea — try again", 502),
    )
    const res = await CHECK(ev({ body: { title: 'x' } }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain("Couldn't check your idea")
  })

  it('AC-15: POST ideas is 201 and reports inbox failed', async () => {
    m.shareBoardIdea.mockResolvedValueOnce({
      idea: { id: ID },
      inbox: 'failed',
      inboxError: 'Owlery 500',
    })
    const res = await CREATE(ev({ body: { title: 'x', kind: 'idea', area: 'yarn' } }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      idea: { id: ID },
      inbox: 'failed',
      inboxError: 'Owlery 500',
    })
  })

  it('POST ideas rejects invalid JSON and unknown kinds with 400', async () => {
    expect((await CREATE(ev({ body: '{nope' }))).status).toBe(400)
    expect((await CREATE(ev({ body: { title: 'x', kind: 'feature', area: 'yarn' } }))).status).toBe(
      400,
    )
  })
})
