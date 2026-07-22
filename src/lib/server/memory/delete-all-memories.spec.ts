import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE_ALL_MEMORIES_CONFIRMATION } from '$lib/memory/delete-confirmation'
import {
  assertDeleteAllMemoriesConfirmation,
  deleteAllMemoriesForUser,
} from './delete-all-memories'

const { getDbMock, deleteAllUserGraphVerticesMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  deleteAllUserGraphVerticesMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/graph/age', () => ({
  deleteAllUserGraphVertices: deleteAllUserGraphVerticesMock,
}))

describe('deleteAllMemoriesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteAllUserGraphVerticesMock.mockResolvedValue(undefined)
  })

  it('rejects wrong confirmation phrase', () => {
    expect(() => assertDeleteAllMemoriesConfirmation('nope')).toThrow(/exactly match/)
  })

  it('accepts the exact confirmation phrase', () => {
    expect(() =>
      assertDeleteAllMemoriesConfirmation(DELETE_ALL_MEMORIES_CONFIRMATION),
    ).not.toThrow()
  })

  it('deletes postgres rows then wipes graph', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]),
        })),
      })),
      delete: vi.fn(() => ({ where: deleteWhere })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    }
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
    })

    const result = await deleteAllMemoriesForUser('u1')

    expect(result).toEqual({ thoughtsDeleted: 2, entitiesDeleted: 2 })
    expect(deleteWhere).toHaveBeenCalled()
    expect(deleteAllUserGraphVerticesMock).toHaveBeenCalledWith('u1')
  })
})
