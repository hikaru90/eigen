import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRuntimeDatabaseUrl } from './runtime-url'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/eigen?uselibpqcompat=true&sslmode=require',
  },
}))

vi.mock('$env/dynamic/private', () => ({
  env: mockEnv,
}))

describe('getRuntimeDatabaseUrl', () => {
  beforeEach(() => {
    mockEnv.DATABASE_URL =
      'postgres://user:pass@localhost:5432/eigen?uselibpqcompat=true&sslmode=require'
  })

  it('removes drizzle-only query flags', () => {
    const runtime = getRuntimeDatabaseUrl()
    expect(runtime).not.toContain('uselibpqcompat')
    expect(runtime).toContain('sslmode=require')
  })

  it('returns raw string for non-url input', () => {
    mockEnv.DATABASE_URL = 'postgres://not a valid url'
    expect(getRuntimeDatabaseUrl()).toBe('postgres://not a valid url')
  })

  it('throws when DATABASE_URL is missing', () => {
    mockEnv.DATABASE_URL = ''
    expect(() => getRuntimeDatabaseUrl()).toThrow(/DATABASE_URL is not set/)
  })
})
