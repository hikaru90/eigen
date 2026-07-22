import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { listMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
}))

vi.mock('$lib/server/text-files/service', () => ({
  listThoughtsForTextFile: listMock,
}))

describe('GET /api/text-files/[fileId]/thoughts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([{ id: 't1' }])
  })

  it('rejects unauthenticated', async () => {
    await expect(
      GET({ locals: { user: null }, params: { fileId: 'f1' } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('lists linked thoughts', async () => {
    const res = await GET({
      locals: { user: { id: 'u1' } },
      params: { fileId: 'f1' },
    } as never)
    expect(await res.json()).toEqual({ linkedThoughts: [{ id: 't1' }] })
    expect(listMock).toHaveBeenCalledWith('u1', 'f1')
  })
})
