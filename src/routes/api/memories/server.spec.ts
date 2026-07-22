import { describe, expect, it, vi } from 'vitest'
import { DELETE } from './+server'

const { deleteAllMemoriesForUserMock, assertDeleteAllMemoriesConfirmationMock } = vi.hoisted(
  () => ({
    deleteAllMemoriesForUserMock: vi.fn(),
    assertDeleteAllMemoriesConfirmationMock: vi.fn(),
  }),
)

vi.mock('$lib/server/memory/delete-all-memories', () => ({
  deleteAllMemoriesForUser: deleteAllMemoriesForUserMock,
  assertDeleteAllMemoriesConfirmation: assertDeleteAllMemoriesConfirmationMock,
}))

describe('DELETE /api/memories', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(
      DELETE({
        locals: { user: null },
        request: new Request('http://localhost/api/memories', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmation: 'DELETE ALL MY MEMORIES' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('deletes memories when confirmation is valid', async () => {
    deleteAllMemoriesForUserMock.mockResolvedValue({ thoughtsDeleted: 3, entitiesDeleted: 1 })
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost/api/memories', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE ALL MY MEMORIES' }),
      }),
    } as never)
    expect(assertDeleteAllMemoriesConfirmationMock).toHaveBeenCalledWith('DELETE ALL MY MEMORIES')
    expect(deleteAllMemoriesForUserMock).toHaveBeenCalledWith('u1')
    expect(await res.json()).toEqual({ ok: true, thoughtsDeleted: 3, entitiesDeleted: 1 })
  })

  it('returns 400 for invalid confirmation text', async () => {
    assertDeleteAllMemoriesConfirmationMock.mockImplementation(() => {
      throw new Error('Confirmation phrase did not match')
    })

    await expect(
      DELETE({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost/api/memories', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmation: 'nope' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })
})
