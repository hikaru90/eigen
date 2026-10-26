import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  order: [] as string[],
  selectRows: [] as unknown[][],
  factIdsMock: vi.fn(),
  retireMock: vi.fn(),
  deleteVertexMock: vi.fn(),
}))

vi.mock('./eval-context', () => ({
  withEvalDb: async (_userId: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => m.selectRows.shift() ?? [] }) }),
    }),
    delete: () => ({
      where: async () => {
        m.order.push('delete thought')
      },
    }),
  }),
}))
vi.mock('$lib/server/graph/age', () => ({ deleteThoughtVertexFromGraph: m.deleteVertexMock }))
vi.mock('$lib/server/facts/user-fact-lifecycle', () => ({
  factIdsDerivedFromThought: m.factIdsMock,
  retireFactsWithoutLiveSource: m.retireMock,
}))

import { deleteCorpusThought } from './delete-corpus-fixture'

beforeEach(() => {
  vi.clearAllMocks()
  m.order = []
  m.selectRows = [[{ id: 't1' }]]
  m.deleteVertexMock.mockResolvedValue(undefined)
  m.factIdsMock.mockImplementation(async () => {
    m.order.push('read fact ids')
    return ['f1']
  })
  m.retireMock.mockImplementation(async () => {
    m.order.push('retire facts')
    return { retired: ['f1'], revived: [] }
  })
})

describe('deleteCorpusThought', () => {
  it('retires the facts the deleted thought carried (their links go with the row, so the ids are read first)', async () => {
    await expect(deleteCorpusThought({ evalUserId: 'eval-1', thoughtId: 't1' })).resolves.toBe(true)
    expect(m.order).toEqual(['read fact ids', 'delete thought', 'retire facts'])
    expect(m.retireMock).toHaveBeenCalledWith('eval-1', ['f1'], { revive: true })
  })

  it('a thought that is already gone touches no fact', async () => {
    m.selectRows = [[]]
    await expect(deleteCorpusThought({ evalUserId: 'eval-1', thoughtId: 't1' })).resolves.toBe(
      false,
    )
    expect(m.factIdsMock).not.toHaveBeenCalled()
    expect(m.retireMock).not.toHaveBeenCalled()
  })
})
