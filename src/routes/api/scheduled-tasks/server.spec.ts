import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { listScheduledTasksMock } = vi.hoisted(() => ({
  listScheduledTasksMock: vi.fn(),
}))

vi.mock('$lib/server/scheduled-tasks/service', () => ({
  listScheduledTasks: listScheduledTasksMock,
}))

describe('GET /api/scheduled-tasks', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 401 })
  })

  it('returns scheduled tasks for authenticated user', async () => {
    listScheduledTasksMock.mockResolvedValue([{ id: 'task-1', paused: false }])

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)

    expect(listScheduledTasksMock).toHaveBeenCalledWith('u1')
    expect(await res.json()).toEqual({ tasks: [{ id: 'task-1', paused: false }] })
  })

  it('returns 500 with empty tasks when listing fails', async () => {
    listScheduledTasksMock.mockRejectedValue(new Error('db unavailable'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ tasks: [], error: 'db unavailable' })
    consoleSpy.mockRestore()
  })
})
