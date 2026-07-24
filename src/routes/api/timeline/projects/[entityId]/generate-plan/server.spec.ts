import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { generateProjectPlanMock } = vi.hoisted(() => ({
  generateProjectPlanMock: vi.fn(),
}))

vi.mock('$lib/server/memory/generate-project-plan', () => ({
  generateProjectPlan: generateProjectPlanMock,
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

describe('POST /api/timeline/projects/[entityId]/generate-plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(POST(makeEvent({ userId: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('generates a plan for the project', async () => {
    generateProjectPlanMock.mockResolvedValue({
      projectEntityId: 'p1',
      projectLabel: 'Launch',
      targetDate: '2026-12-01T00:00:00.000Z',
      milestones: [],
      tasks: [{ thoughtId: 't1', summary: 'Draft', rank: 1, isNextAction: true }],
    })

    const res = await POST(makeEvent({ userId: 'u1', body: { goal: 'Ship beta' } }))
    const body = await res.json()

    expect(generateProjectPlanMock).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      goal: 'Ship beta',
    })
    expect(body.tasks).toHaveLength(1)
    expect(body.projectLabel).toBe('Launch')
  })
})
