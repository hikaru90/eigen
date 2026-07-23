import { beforeEach, describe, expect, it, vi } from 'vitest'

const { withDbUserMock, getDbMock } = vi.hoisted(() => ({
  withDbUserMock: vi.fn(),
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
  withDbUser: withDbUserMock,
}))

vi.mock('./community-bundles', () => ({
  buildCommunityBundle: vi.fn(async () => true),
}))

import { scheduleIncrementalConsolidation } from './incremental-consolidation'

function emptyThenableDb() {
  const where = vi.fn(() =>
    Object.assign(Promise.resolve([] as unknown[]), {
      limit: vi.fn(async () => []),
      innerJoin: vi.fn(() => ({ where: vi.fn(async () => []) })),
    }),
  )
  const from = vi.fn(() => ({ where }))
  return { select: vi.fn(() => ({ from })) }
}

describe('scheduleIncrementalConsolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue(emptyThenableDb())
    withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<unknown>) =>
      fn(),
    )
  })

  it('self-wraps the refresh in its own tenant connection (withDbUser)', async () => {
    scheduleIncrementalConsolidation('u1', 't1')

    await vi.waitFor(() => {
      expect(withDbUserMock).toHaveBeenCalledWith('u1', expect.any(Function))
    })
  })

  it('contains failures to a loud warning (no unhandled rejection)', async () => {
    withDbUserMock.mockRejectedValue(new Error('pool exhausted'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    scheduleIncrementalConsolidation('u1', 't1')

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[incremental-consolidation] refresh failed',
        expect.objectContaining({ userId: 'u1', thoughtId: 't1' }),
      )
    })
    warnSpy.mockRestore()
  })
})
