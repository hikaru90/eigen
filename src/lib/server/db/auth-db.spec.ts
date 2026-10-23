import { describe, expect, it, vi } from 'vitest'

// `postgres` is mocked below (no real connection), but runtime URL normalization
// still requires the env key — CI runs env-less, so stub the env source.
vi.mock('$lib/server/env/private-env', () => ({
  env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
}))

import { authSql, closeAuthDbPool } from './auth-db'

const { endMock, queryMock } = vi.hoisted(() => ({
  endMock: vi.fn(async () => undefined),
  // the real postgres() client is itself callable (tagged template) and carries methods
  queryMock: vi.fn(async () => [{ id: 'k1' }]),
}))

vi.mock('postgres', () => ({
  default: vi.fn(() => Object.assign(queryMock, { end: endMock })),
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({ mocked: true })),
}))

describe('db/auth-db', () => {
  it('authSql is callable as a tagged template (API-key auth in hooks.server.ts)', async () => {
    const keyHash = 'abc'
    const rows = await authSql`SELECT id FROM user_api_key WHERE key_hash = ${keyHash}`
    expect(rows).toEqual([{ id: 'k1' }])
    const [strings, value] = queryMock.mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(strings.join('?')).toBe('SELECT id FROM user_api_key WHERE key_hash = ?')
    expect(value).toBe('abc')
  })

  it('closeAuthDbPool closes auth pool', async () => {
    await closeAuthDbPool()
    expect(endMock).toHaveBeenCalled()
  })
})
