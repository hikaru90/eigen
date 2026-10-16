import { describe, expect, it, vi } from 'vitest'

// `postgres` is mocked below (no real connection), but runtime URL normalization
// still requires the env key — CI runs env-less, so stub the env source.
vi.mock('$lib/server/env/private-env', () => ({
  env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
}))

import { closeAuthDbPool } from './auth-db'

const { endMock } = vi.hoisted(() => ({
  endMock: vi.fn(async () => undefined),
}))

vi.mock('postgres', () => ({
  default: vi.fn(() => ({
    end: endMock,
  })),
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({ mocked: true })),
}))

describe('db/auth-db', () => {
  it('closeAuthDbPool closes auth pool', async () => {
    await closeAuthDbPool()
    expect(endMock).toHaveBeenCalled()
  })
})
