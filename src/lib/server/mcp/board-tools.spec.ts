import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runForgetIdeaTool,
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
}))

vi.mock('$lib/server/board/service', () => ({
  listBoardIdeas: m.listBoardIdeas,
  setBoardVote: m.setBoardVote,
  deleteBoardIdea: m.deleteBoardIdea,
}))
vi.mock('$lib/server/board/share', () => ({
  checkBoardIdea: m.checkBoardIdea,
  shareBoardIdea: m.shareBoardIdea,
}))

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = { userId: 'u1' }

beforeEach(() => vi.clearAllMocks())

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
    const forced = await runShareIdeaTool(ctx, { title: 'Mesh needs a dark theme', mine_is_different: true })
    expect(forced).toMatchObject({ created: true })
  })

  it('vote_idea returns the new score', async () => {
    m.setBoardVote.mockResolvedValue({ score: 2, myVote: 1 })
    expect(await runVoteIdeaTool(ctx, { idea_id: ID, direction: 1 })).toEqual({ ideaId: ID, score: 2, myVote: 1 })
  })

  it('negative probe: direction 2 fails loud with the constraint', async () => {
    await expect(runVoteIdeaTool(ctx, { idea_id: ID, direction: 2 })).rejects.toThrow(
      'Invalid direction: 2. Must be -1, 0 or 1',
    )
    expect(m.setBoardVote).not.toHaveBeenCalled()
  })

  it('rejects bad ids and unknown arguments before any DB work', async () => {
    await expect(runVoteIdeaTool(ctx, { idea_id: 'abc', direction: 1 })).rejects.toThrow(/Must be a UUID/)
    await expect(runForgetIdeaTool(ctx, { idea_id: ID, force: true })).rejects.toThrow(/Unknown argument: force/)
    await expect(runShareIdeaTool(ctx, { title: '' })).rejects.toThrow(/title/)
    await expect(runListBoardTool(ctx, { status: 'done' })).rejects.toThrow(/Invalid status/)
  })

  it('list_board filters by status and strips embeddings', async () => {
    m.listBoardIdeas.mockResolvedValue([
      { id: 'a', status: 'requested', title_embedding: Array(1536).fill(0) },
      { id: 'b', status: 'shipped' },
    ])
    const res = (await runListBoardTool(ctx, { status: 'requested' })) as { ideas: Array<Record<string, unknown>> }
    expect(res.ideas.map((i) => i.id)).toEqual(['a'])
    expect(JSON.stringify(res)).not.toMatch(/title_embedding/)
  })

  it('forget_idea deletes and confirms', async () => {
    m.deleteBoardIdea.mockResolvedValue(undefined)
    expect(await runForgetIdeaTool(ctx, { idea_id: ID })).toEqual({ forgotten: true, ideaId: ID })
    expect(m.deleteBoardIdea).toHaveBeenCalledWith('u1', ID)
  })
})
