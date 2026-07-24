import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { reviewProjectMock } = vi.hoisted(() => ({
  reviewProjectMock: vi.fn(),
}))

vi.mock('$lib/server/memory/project-review', () => ({
  reviewProject: reviewProjectMock,
}))

function makeEvent(input: {
  userId?: string | null
  entityId?: string
  body?: unknown
}) {
  return {
    locals: { user: input.userId ? { id: input.userId } : null },
    params: { entityId: input.entityId ?? 'p1' },
    request: {
      text: async () => (input.body === undefined ? '' : JSON.stringify(input.body)),
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/timeline/projects/[entityId]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(POST(makeEvent({ userId: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns a dry-run review payload', async () => {
    reviewProjectMock.mockResolvedValue({
      projectEntityId: 'p1',
      projectLabel: 'Launch',
      projectDeadline: null,
      tasks: [],
      linkedThoughts: [],
      allowedThoughtIds: ['t1'],
      review: {
        projectDeadline: '2026-12-01T00:00:00.000Z',
        taskReviews: [{ thoughtId: 't1', suggestion: 'keep', deadline: null, reason: 'ok' }],
        order: ['t1'],
        newTaskSuggestions: [],
        nextActionThoughtId: 't1',
        nextActionIsNewTaskIndex: null,
      },
    })

    const res = await POST(makeEvent({ userId: 'u1', body: {} }))
    const body = await res.json()

    expect(reviewProjectMock).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
    })
    expect(body.review.nextActionThoughtId).toBe('t1')
    expect(body.allowedThoughtIds).toEqual(['t1'])
  })
})
