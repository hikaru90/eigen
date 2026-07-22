import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE } from './+server'

const { unlinkMock } = vi.hoisted(() => ({
  unlinkMock: vi.fn(),
}))

vi.mock('$lib/server/text-files/service', () => ({
  unlinkTextFileFromThought: unlinkMock,
}))

describe('DELETE /api/thoughts/[thoughtId]/text-files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unlinkMock.mockResolvedValue(true)
  })

  it('rejects unauthenticated', async () => {
    await expect(
      DELETE({
        locals: { user: null },
        params: { thoughtId: 't1', fileId: 'f1' },
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('unlinks attachment', async () => {
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { thoughtId: 't1', fileId: 'f1' },
    } as never)
    expect(await res.json()).toEqual({
      unlinked: true,
      thoughtId: 't1',
      textFileId: 'f1',
    })
  })

  it('404 when link missing', async () => {
    unlinkMock.mockResolvedValue(false)
    await expect(
      DELETE({
        locals: { user: { id: 'u1' } },
        params: { thoughtId: 't1', fileId: 'f1' },
      } as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})
