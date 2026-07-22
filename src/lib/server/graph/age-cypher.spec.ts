import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertTenantScopedCypherParams,
  runTenantScopedCypher,
  wrapAgeCypherDollarQuote,
} from './age-cypher'

const { executeMock, getDbMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getDbMock: vi.fn(),
}))

getDbMock.mockImplementation(() => ({ execute: executeMock }))

const { env } = vi.hoisted(() => ({
  env: { AGE_GRAPH_NAME: 'eigen_graph' },
}))

vi.mock('$env/dynamic/private', () => ({ env }))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/activity/log-call', () => ({
  logActivityCall: vi.fn(),
}))

describe('wrapAgeCypherDollarQuote', () => {
  it('wraps cypher in $$ delimiters', () => {
    expect(wrapAgeCypherDollarQuote('MATCH (n) RETURN n')).toBe('$$MATCH (n) RETURN n$$')
  })

  it('uses a tagged delimiter when the query contains $$', () => {
    expect(wrapAgeCypherDollarQuote('RETURN $$')).toBe('$age_cypher$RETURN $$$age_cypher$')
  })
})

describe('tenant-scoped Cypher guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.AGE_GRAPH_NAME = 'eigen_graph'
    executeMock.mockImplementation(async () => ({ rows: [] }))
  })

  it('assertTenantScopedCypherParams rejects missing user_id', () => {
    expect(() => assertTenantScopedCypherParams('u1', { id: 't1' })).toThrow(/params\.user_id/)
  })

  it('assertTenantScopedCypherParams rejects user_id mismatch', () => {
    expect(() => assertTenantScopedCypherParams('u1', { user_id: 'u2' })).toThrow(/must match/)
  })

  it('runTenantScopedCypher throws before executing when user_id is missing', async () => {
    await expect(
      runTenantScopedCypher(
        'u1',
        'MATCH (n {user_id: $user_id}) RETURN n',
        { id: 't1' },
        'n agtype',
      ),
    ).rejects.toThrow(/params\.user_id/)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('runTenantScopedCypher executes when user_id matches', async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ n: 't1' }] })
    await runTenantScopedCypher(
      'u1',
      'MATCH (n {user_id: $user_id}) RETURN n',
      { user_id: 'u1' },
      'n agtype',
    )
    expect(executeMock).toHaveBeenCalled()
  })
})
