import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIdea } from '$lib/feedback/board-types'
import { BoardError } from './errors'
import { checkBoardIdea, shareBoardIdea } from './share'

const m = vi.hoisted(() => ({
  createThoughtEmbedding: vi.fn(),
  findDuplicateCandidates: vi.fn(),
  insertBoardIdea: vi.fn(),
  getBoardIdea: vi.fn(),
  loadUserEmail: vi.fn(),
  judgeBoardIdea: vi.fn(),
  assertFeedbackMailConfigured: vi.fn(),
  sendFeedbackInboxEmail: vi.fn(),
}))

vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbedding: m.createThoughtEmbedding }))
vi.mock('./service', () => ({
  findDuplicateCandidates: m.findDuplicateCandidates,
  insertBoardIdea: m.insertBoardIdea,
  getBoardIdea: m.getBoardIdea,
  loadUserEmail: m.loadUserEmail,
}))
vi.mock('./judge', () => ({ judgeBoardIdea: m.judgeBoardIdea }))
vi.mock('$lib/server/feedback/send-feedback-email', () => ({
  assertFeedbackMailConfigured: m.assertFeedbackMailConfigured,
  sendFeedbackInboxEmail: m.sendFeedbackInboxEmail,
}))

const ID = '11111111-1111-4111-8111-111111111111'
const idea = (over: Partial<BoardIdea> = {}): BoardIdea => ({
  id: ID,
  title: 'Dark mode for Mesh',
  kind: 'idea',
  area: 'yarn',
  status: 'requested',
  planned: false,
  note: null,
  score: 1,
  myVote: 1,
  author: { display: 'Noor K.', isYou: true },
  createdAt: '2026-10-23T10:00:00.000Z',
  shippedAt: null,
  own: true,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.createThoughtEmbedding.mockResolvedValue(Array(1536).fill(0.01))
  m.findDuplicateCandidates.mockResolvedValue([
    { id: ID, title: 'Dark mode for Mesh', kind: 'idea', area: 'yarn', status: 'requested' },
  ])
  m.insertBoardIdea.mockResolvedValue({ ideaId: ID, feedbackId: 'fb-1' })
  m.getBoardIdea.mockResolvedValue(idea())
  m.loadUserEmail.mockResolvedValue('noor@example.com')
  m.sendFeedbackInboxEmail.mockResolvedValue({ emailId: 'em-1' })
})

describe('checkBoardIdea', () => {
  it('AC-12: returns the judged duplicate as a board row (from the caller’s view)', async () => {
    m.judgeBoardIdea.mockResolvedValue({ kind: 'idea', area: 'yarn', duplicateOfId: ID })
    m.getBoardIdea.mockResolvedValue(
      idea({ own: false, myVote: 0, author: { display: 'Noor K.', isYou: false } }),
    )
    const res = await checkBoardIdea('ub', 'Mesh needs a dark theme')
    expect(res.kind).toBe('idea')
    expect(res.duplicateOf?.id).toBe(ID)
    expect(m.judgeBoardIdea).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'ub', title: 'Mesh needs a dark theme' }),
    )
    expect(JSON.stringify(res)).not.toMatch(/embedding/i)
  })

  it('returns duplicateOf null when the judge found none', async () => {
    m.judgeBoardIdea.mockResolvedValue({ kind: 'bug', area: 'capture', duplicateOfId: null })
    const res = await checkBoardIdea('ub', 'Voice capture cuts off')
    expect(res).toEqual({ kind: 'bug', area: 'capture', duplicateOf: null })
  })

  it('AC-16: a failed judge stops the check — nothing is created', async () => {
    m.judgeBoardIdea.mockRejectedValue(new BoardError("Couldn't check your idea — try again", 502))
    await expect(checkBoardIdea('ub', 'x')).rejects.toMatchObject({ status: 502 })
    expect(m.insertBoardIdea).not.toHaveBeenCalled()
  })
})

describe('shareBoardIdea', () => {
  it('creates the idea, then delivers it to the makers’ inbox', async () => {
    const res = await shareBoardIdea({
      userId: 'ua',
      title: 'Dark mode for Mesh',
      kind: 'idea',
      area: 'yarn',
    })
    expect(res).toEqual({ idea: idea(), inbox: 'sent' })
    expect(m.insertBoardIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'ua',
        title: 'Dark mode for Mesh',
        kind: 'idea',
        area: 'yarn',
      }),
    )
    expect(m.sendFeedbackInboxEmail).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackId: 'fb-1', userId: 'ua', userEmail: 'noor@example.com' }),
    )
  })

  it('AC-15: keeps the idea and reports inbox failed when the email fails', async () => {
    m.sendFeedbackInboxEmail.mockRejectedValue(new Error('Owlery 500'))
    const res = await shareBoardIdea({ userId: 'ua', title: 'x', kind: 'idea', area: 'yarn' })
    expect(res.inbox).toBe('failed')
    expect(res.inboxError).toContain('Owlery 500')
    expect(res.idea.id).toBe(ID)
  })

  it('AC-15: reports inbox failed when mail is not configured — still creates the idea', async () => {
    m.assertFeedbackMailConfigured.mockImplementation(() => {
      throw new Error('Feedback email is not configured')
    })
    const res = await shareBoardIdea({ userId: 'ua', title: 'x', kind: 'idea', area: 'yarn' })
    expect(res).toMatchObject({
      inbox: 'failed',
      inboxError: expect.stringContaining('not configured'),
    })
    expect(m.insertBoardIdea).toHaveBeenCalled()
    expect(m.sendFeedbackInboxEmail).not.toHaveBeenCalled()
  })

  it('fails before creating anything when the embedding call fails', async () => {
    m.createThoughtEmbedding.mockRejectedValue(new Error('LLM HTTP 500'))
    await expect(
      shareBoardIdea({ userId: 'ua', title: 'x', kind: 'idea', area: 'yarn' }),
    ).rejects.toThrow('LLM HTTP 500')
    expect(m.insertBoardIdea).not.toHaveBeenCalled()
  })
})
