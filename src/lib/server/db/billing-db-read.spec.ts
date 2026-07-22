import { describe, expect, it, vi, beforeEach } from 'vitest'

const { activateTenantDbSessionMock, withDbUserMock } = vi.hoisted(() => ({
  activateTenantDbSessionMock: vi.fn(),
  withDbUserMock: vi.fn(),
}))

vi.mock('$lib/server/db/tenant-session', () => ({
  activateTenantDbSession: activateTenantDbSessionMock,
}))

vi.mock('$lib/server/db/index', () => ({
  withDbUser: withDbUserMock,
}))

import { appDbAsyncLocal, appReservedSqlAsyncLocal } from '$lib/server/db/context'
import { billingUserAsyncLocal, tenantUserAsyncLocal } from '$lib/server/billing/context'
import { withBillingUserDbRead } from '$lib/server/db/billing-db-read'

describe('withBillingUserDbRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    withDbUserMock.mockImplementation(async (_id: string, fn: (db: object) => unknown) =>
      fn({ tag: 'fallback' }),
    )
  })

  it('reuses the reserved connection when billing context differs from tenant', async () => {
    const db = { tag: 'scoped' }
    const sql = { id: 'reserved' }

    const result = await appDbAsyncLocal.run(db as never, () =>
      appReservedSqlAsyncLocal.run(sql as never, () =>
        tenantUserAsyncLocal.run('corpus-user', () =>
          billingUserAsyncLocal.run('operator', () =>
            withBillingUserDbRead('operator', async (innerDb) => innerDb),
          ),
        ),
      ),
    )

    expect(result).toBe(db)
    expect(activateTenantDbSessionMock).toHaveBeenCalledWith(sql, 'operator')
    expect(activateTenantDbSessionMock).toHaveBeenCalledWith(sql, 'corpus-user')
    expect(withDbUserMock).not.toHaveBeenCalled()
  })

  it('falls back to withDbUser without a reserved eval connection', async () => {
    const result = await withBillingUserDbRead('operator', async (db) => db)
    expect(result).toEqual({ tag: 'fallback' })
    expect(withDbUserMock).toHaveBeenCalledWith('operator', expect.any(Function))
  })
})
