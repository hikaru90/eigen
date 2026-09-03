import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { applyProjectReviewMock } = vi.hoisted(() => ({
  applyProjectReviewMock: vi.fn(),
}))

vi.mock('$lib/server/memory/project-review', () => ({
  applyProjectReview: applyProjectReviewMock,
}))

function makeEvent(input: { userId?: string | null; entityId?: string; body?: unknown }) {
  return {
    locals: { user: input.userId ? { id: input.userId } : null },
    params: { entityId: input.entityId ?? 'p1' },
    request: {
      text: async () => (input.body === undefined ? '' : JSON.stringify(input.body)),
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/timeline/projects/[entityId]/review/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(POST(makeEvent({ userId: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('applies the confirmed subset', async () => {
    applyProjectReviewMock.mockResolvedValue({
      projectEntityId: 'p1',
      createdThoughtIds: [],
      nextActionThoughtId: 't1',
    })

    const res = await POST(
      makeEvent({
        userId: 'u1',
        body: {
          markDone: ['t2'],
          archive: [],
          deadlines: [],
          order: ['t1'],
          projectDeadline: null,
          newTasks: [],
          nextActionThoughtId: 't1',
          nextActionNewTaskIndex: null,
          allowedThoughtIds: ['t1', 't2'],
        },
      }),
    )
    const body = await res.json()

    expect(applyProjectReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        projectEntityId: 'p1',
        markDone: ['t2'],
        order: ['t1'],
        nextActionThoughtId: 't1',
        allowedThoughtIds: ['t1', 't2'],
      }),
    )
    expect(body.nextActionThoughtId).toBe('t1')
  })
})
