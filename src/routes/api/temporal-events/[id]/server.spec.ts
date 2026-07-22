import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE } from './+server'

const { archiveMock } = vi.hoisted(() => ({
  archiveMock: vi.fn(),
}))

vi.mock('$lib/server/memory/temporal-event-service', () => ({
  archiveTemporalEventForUser: archiveMock,
}))

describe('DELETE /api/temporal-events/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    archiveMock.mockResolvedValue({ id: 'e1', archived: true })
  })

  it('rejects unauthenticated requests', async () => {
    await expect(
      DELETE({ locals: { user: null }, params: { id: 'e1' } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects missing event id', async () => {
    await expect(
      DELETE({ locals: { user: { id: 'u1' } }, params: { id: '  ' } } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('archives the event', async () => {
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { id: 'e1' },
    } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'e1', archived: true })
    expect(archiveMock).toHaveBeenCalledWith('u1', 'e1')
  })

  it('maps not-found errors to 404', async () => {
    archiveMock.mockRejectedValue(new Error('event not found'))
    await expect(
      DELETE({ locals: { user: { id: 'u1' } }, params: { id: 'e1' } } as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})
