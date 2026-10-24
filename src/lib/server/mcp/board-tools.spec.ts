import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runForgetIdeaTool,
  runUpdateIdeaTool,
  runListBoardTool,
  runShareIdeaTool,
  runVoteIdeaTool,
} from './board-tools'

const m = vi.hoisted(() => ({
  listBoardIdeas: vi.fn(),
  setBoardVote: vi.fn(),
  deleteBoardIdea: vi.fn(),
  checkBoardIdea: vi.fn(),
  shareBoardIdea: vi.fn(),
  adminEditBoardIdea: vi.fn(async () => ({ reward: null })),
  adminDeleteBoardIdea: vi.fn(),
  getBoardIdea: vi.fn(),
  isUserAdmin: vi.fn(),
}))

vi.mock('$lib/server/board/service', () => ({
  listBoardIdeas: m.listBoardIdeas,
  setBoardVote: m.setBoardVote,
  deleteBoardIdea: m.deleteBoardIdea,
  adminDeleteBoardIdea: m.adminDeleteBoardIdea,
  getBoardIdea: m.getBoardIdea,
}))
vi.mock('$lib/server/auth/user-role', () => ({ isUserAdmin: m.isUserAdmin }))
vi.mock('$lib/server/board/share', () => ({
  adminEditBoardIdea: m.adminEditBoardIdea,
  checkBoardIdea: m.checkBoardIdea,
  shareBoardIdea: m.shareBoardIdea,
}))

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = { userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  m.isUserAdmin.mockResolvedValue(false)
})

describe('board MCP tools (AC-11: share → vote → list → forget in ≤ 4 calls)', () => {
  it('share_idea runs the judge, then creates the idea with the judged kind/area', async () => {
    m.checkBoardIdea.mockResolvedValue({ kind: 'bug', area: 'capture', duplicateOf: null })
    m.shareBoardIdea.mockResolvedValue({ idea: { id: ID, score: 1 }, inbox: 'sent' })
    const res = await runShareIdeaTool(ctx, { title: '  Voice capture cuts off ' })
    expect(m.shareBoardIdea).toHaveBeenCalledWith({
      userId: 'u1',
      title: 'Voice capture cuts off',
      kind: 'bug',
      area: 'capture',
    })
    expect(res).toEqual({ created: true, idea: { id: ID, score: 1 }, inbox: 'sent' })
  })

  it('share_idea stops at a judged duplicate unless mine_is_different is true', async () => {
    m.checkBoardIdea.mockResolvedValue({ kind: 'idea', area: 'yarn', duplicateOf: { id: ID } })
    expect(await runShareIdeaTool(ctx, { title: 'Mesh needs a dark theme' })).toEqual({
      created: false,
      duplicateOf: { id: ID },
      hint: expect.stringContaining('vote_idea'),
    })
    expect(m.shareBoardIdea).not.toHaveBeenCalled()
    m.shareBoardIdea.mockResolvedValue({ idea: { id: 'new' }, inbox: 'sent' })
    const forced = await runShareIdeaTool(ctx, {
      title: 'Mesh needs a dark theme',
      mine_is_different: true,
    })
    expect(forced).toMatchObject({ created: true })
  })

  it('vote_idea returns the new score', async () => {
    m.setBoardVote.mockResolvedValue({ score: 2, myVote: 1 })
    expect(await runVoteIdeaTool(ctx, { idea_id: ID, direction: 1 })).toEqual({
      ideaId: ID,
      score: 2,
      myVote: 1,
    })
  })

  it('negative probe: direction 2 fails loud with the constraint', async () => {
    await expect(runVoteIdeaTool(ctx, { idea_id: ID, direction: 2 })).rejects.toThrow(
      'Invalid direction: 2. Must be -1, 0 or 1',
    )
    expect(m.setBoardVote).not.toHaveBeenCalled()
  })

  it('rejects bad ids and unknown arguments before any DB work', async () => {
    await expect(runVoteIdeaTool(ctx, { idea_id: 'abc', direction: 1 })).rejects.toThrow(
      /Must be a UUID/,
    )
    await expect(runForgetIdeaTool(ctx, { idea_id: ID, force: true })).rejects.toThrow(
      /Unknown argument: force/,
    )
    await expect(runShareIdeaTool(ctx, { title: '' })).rejects.toThrow(/title/)
    await expect(runListBoardTool(ctx, { status: 'done' })).rejects.toThrow(/Invalid status/)
  })

  it('list_board filters by status and strips embeddings', async () => {
    m.listBoardIdeas.mockResolvedValue([
      { id: 'a', status: 'requested', title_embedding: Array(1536).fill(0) },
      { id: 'b', status: 'shipped' },
    ])
    const res = (await runListBoardTool(ctx, { status: 'requested' })) as {
      ideas: Array<Record<string, unknown>>
    }
    expect(res.ideas.map((i) => i.id)).toEqual(['a'])
    expect(JSON.stringify(res)).not.toMatch(/title_embedding/)
  })

  it('forget_idea deletes and confirms', async () => {
    m.deleteBoardIdea.mockResolvedValue(undefined)
    expect(await runForgetIdeaTool(ctx, { idea_id: ID })).toEqual({ forgotten: true, ideaId: ID })
    expect(m.deleteBoardIdea).toHaveBeenCalledWith('u1', ID)
    expect(m.adminDeleteBoardIdea).not.toHaveBeenCalled()
  })

  it('forget_idea with an admin key deletes any idea through the makers path', async () => {
    m.isUserAdmin.mockResolvedValue(true)
    expect(await runForgetIdeaTool(ctx, { idea_id: ID })).toEqual({ forgotten: true, ideaId: ID })
    expect(m.adminDeleteBoardIdea).toHaveBeenCalledWith(ID)
    expect(m.deleteBoardIdea).not.toHaveBeenCalled()
  })
})

describe('update_idea (makers: title, status, note)', () => {
  beforeEach(() => m.isUserAdmin.mockResolvedValue(true))

  it('edits the title (trimmed)', async () => {
    m.getBoardIdea.mockResolvedValue({ id: ID, title: 'Clearer words' })
    await runUpdateIdeaTool(ctx, { idea_id: ID, title: '  Clearer words ' })
    expect(m.adminEditBoardIdea).toHaveBeenCalledWith('u1', ID, { title: 'Clearer words' })
  })

  it('negative probe: a non-admin is refused before any write', async () => {
    m.isUserAdmin.mockResolvedValue(false)
    await expect(runUpdateIdeaTool(ctx, { idea_id: ID, title: 'x' })).rejects.toThrow(/makers/)
    expect(m.adminEditBoardIdea).not.toHaveBeenCalled()
  })

  it('sets status and note, then returns the idea (null once rejected — off the board)', async () => {
    m.getBoardIdea.mockResolvedValue({ id: ID, status: 'in-progress' })
    const res = await runUpdateIdeaTool(ctx, { idea_id: ID, status: 'in-progress', note: 'On it.' })
    expect(m.adminEditBoardIdea).toHaveBeenCalledWith('u1', ID, {
      status: 'in-progress',
      note: 'On it.',
    })
    expect(res).toEqual({ ideaId: ID, idea: { id: ID, status: 'in-progress' }, reward: null })

    m.getBoardIdea.mockResolvedValue(null)
    const rejected = await runUpdateIdeaTool(ctx, { idea_id: ID, status: 'rejected' })
    expect(m.adminEditBoardIdea).toHaveBeenLastCalledWith('u1', ID, { status: 'rejected' })
    expect(rejected).toEqual({ ideaId: ID, idea: null, reward: null })
  })

  it('shipping reports the author reward the service paid', async () => {
    const reward = { authorUserId: 'a1', credits: 5, push: 'no_device' }
    m.adminEditBoardIdea.mockResolvedValueOnce({ reward })
    m.getBoardIdea.mockResolvedValue({ id: ID, status: 'shipped' })
    const res = await runUpdateIdeaTool(ctx, { idea_id: ID, status: 'shipped' })
    expect(res).toMatchObject({ reward })
  })

  it('fails loud on bad status, unknown keys, or nothing to change', async () => {
    await expect(runUpdateIdeaTool(ctx, { idea_id: ID, status: 'done' })).rejects.toThrow(/status/)
    await expect(runUpdateIdeaTool(ctx, { idea_id: ID, hidden: true })).rejects.toThrow(
      /Unknown argument: hidden/,
    )
    await expect(runUpdateIdeaTool(ctx, { idea_id: ID })).rejects.toThrow(/Nothing to change/)
    await expect(runUpdateIdeaTool(ctx, { idea_id: ID, title: '   ' })).rejects.toThrow(/empty/)
    expect(m.adminEditBoardIdea).not.toHaveBeenCalled()
  })
})
