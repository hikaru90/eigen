import { beforeEach, describe, expect, it, vi } from 'vitest'
import { envPaste, FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import { runAgentWithEvent } from './run-agent'

const { getDbMock, encryptMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  encryptMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ encryptTenantValue: encryptMock }))

function mockDb() {
  const values = vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'thought-1' }]) }))
  getDbMock.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 'agent-1', enabled: true }]) })),
      })),
    })),
    insert: vi.fn(() => ({ values })),
  })
  return { values }
}

describe('runAgentWithEvent secret hygiene (docs/planning/secret-hygiene.md)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(
      async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`,
    )
  })

  it('derives the stored normalized text and the returned summary from the redacted event, keeping the original only in raw_text', async () => {
    const { values } = mockDb()
    const original = `deploy finished ${envPaste()} token ${FAKE_SECRETS.githubClassic}`

    const result = await runAgentWithEvent({
      userId: 'u1',
      agentId: 'agent-1',
      eventType: 'deploy',
      payload: { summary: original },
    })

    const row = (values.mock.calls[0] as unknown as [Record<string, string>])[0]
    expect(leaks(row.normalizedText)).toBe(false)
    expect(leaks(row.normalizedTextEncrypted)).toBe(false)
    expect(leaks(result.summary)).toBe(false)
    // the verbatim event stays encrypted in raw_text
    expect(row.rawTextEncrypted).toContain(FAKE_SECRETS.githubClassic)
  })
})
