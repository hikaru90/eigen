import { describe, expect, it, vi } from 'vitest'
import { acceptBetaAgreement } from './beta-agreement'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))

function captureInsert() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate }) })
  getDbMock.mockReturnValue({ insert: insert })
  return { insert, onConflictDoUpdate }
}

describe('acceptBetaAgreement', () => {
  it('sets beta_agreement_accepted_at to now for the user via upsert', async () => {
    const before = Date.now() - 1
    const { insert, onConflictDoUpdate } = captureInsert()

    await acceptBetaAgreement('u1')

    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0].length).toBe(1)
    const valuesMock = insert.mock.results[0].value as {
      values: ReturnType<typeof vi.fn>
    }
    expect(valuesMock.values).toHaveBeenCalledTimes(1)
    const values = valuesMock.values.mock.calls[0][0] as Record<string, unknown>
    expect(values.userId).toBe('u1')
    const acceptedAt = values.betaAgreementAcceptedAt as Date
    expect(acceptedAt).toBeInstanceOf(Date)
    expect(acceptedAt.getTime()).toBeGreaterThanOrEqual(before)

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
    const [conflictArg] = onConflictDoUpdate.mock.calls[0] as [
      { target: unknown; set: Record<string, unknown> },
    ]
    expect(conflictArg.set.betaAgreementAcceptedAt).toBeInstanceOf(Date)
  })
})
