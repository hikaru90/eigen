import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listScheduledTasksMock } = vi.hoisted(() => ({
  listScheduledTasksMock: vi.fn(),
}))

vi.mock('$lib/server/scheduled-tasks/service', () => ({
  listScheduledTasks: listScheduledTasksMock,
}))

import { load } from './+page.server'

describe('settings/scheduled-tasks page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listScheduledTasksMock.mockResolvedValue([])
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns empty tasks without throwing when authenticated', async () => {
    const result = await load({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
    } as never)

    expect(result).toEqual({ tasks: [] })
    expect(listScheduledTasksMock).toHaveBeenCalledWith('u1')
  })

  it('returns empty tasks with loadError when the service throws', async () => {
    listScheduledTasksMock.mockRejectedValueOnce(new Error('db down'))

    const result = await load({
      locals: { user: { id: 'u1' } },
    } as never)

    expect(result).toEqual({ tasks: [], loadError: 'db down' })
  })
})
