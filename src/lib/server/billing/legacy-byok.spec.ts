import { beforeEach, describe, expect, it, vi } from 'vitest'

const { withDbUserMock, captureServerEventMock } = vi.hoisted(() => ({
  withDbUserMock: vi.fn(),
  captureServerEventMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ withDbUser: withDbUserMock }))
vi.mock('$lib/server/analytics/posthog-server', () => ({
  captureServerEvent: captureServerEventMock,
}))

import { clearLegacyByokForUser, legacyByokMigrationNeeded } from './legacy-byok'

describe('legacyByokMigrationNeeded', () => {
  it('returns false when BYOK UI is enabled', () => {
    expect(
      legacyByokMigrationNeeded({
        byokUiEnabled: true,
        billingMode: 'byok',
        hasStoredCredentials: true,
      }),
    ).toBe(false)
  })

  it('returns false when BYOK UI is disabled and user has no legacy BYOK state', () => {
    expect(
      legacyByokMigrationNeeded({
        byokUiEnabled: false,
        billingMode: 'platform_credits',
        hasStoredCredentials: false,
      }),
    ).toBe(false)
  })

  it('returns true when BYOK UI is disabled and billing mode is byok', () => {
    expect(
      legacyByokMigrationNeeded({
        byokUiEnabled: false,
        billingMode: 'byok',
        hasStoredCredentials: false,
      }),
    ).toBe(true)
  })

  it('returns true when BYOK UI is disabled and stored credentials exist', () => {
    expect(
      legacyByokMigrationNeeded({
        byokUiEnabled: false,
        billingMode: 'platform_credits',
        hasStoredCredentials: true,
      }),
    ).toBe(true)
  })
})

describe('clearLegacyByokForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes provider rows, clears active provider, and sets platform credits', async () => {
    const deleteMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    })
    const db = { delete: deleteMock, insert: insertMock }

    withDbUserMock.mockImplementation(async (_userId, fn) => fn(db))

    await clearLegacyByokForUser('user-1')

    expect(withDbUserMock).toHaveBeenCalledWith('user-1', expect.any(Function))
    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(captureServerEventMock).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'legacy_byok_migrated_to_platform_credits',
      properties: {},
    })
  })
})
