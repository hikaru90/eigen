import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertTenantScopedCypherParams,
  renderCypherQuery,
  runTenantScopedCypher,
  toCypherLiteral,
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

describe('toCypherLiteral (hostile input)', () => {
  it('escapes single quotes so values cannot break out of string literals', () => {
    expect(toCypherLiteral("x' OR 1=1 --")).toBe("'x\\' OR 1=1 --'")
  })

  it('escapes backslashes before quotes (escape order round-trips)', () => {
    // Input: backslash + quote. Cypher must parse it back as backslash + quote,
    // not as an escaped quote that closes the literal.
    expect(toCypherLiteral("\\'")).toBe("'\\\\\\''")
  })

  it('keeps param-like values inert ($-patterns in values are quoted, never re-scanned)', () => {
    expect(renderCypherQuery('MATCH (n {id: $id}) RETURN n', { id: '$user_id' })).toBe(
      "MATCH (n {id: '$user_id'}) RETURN n",
    )
  })

  it('cannot inject through nested arrays', () => {
    expect(toCypherLiteral(['a', "b'", ['c\\']])).toBe("['a', 'b\\'', ['c\\\\']]")
  })

  it('throws on non-finite numbers and objects instead of emitting invalid cypher', () => {
    expect(() => toCypherLiteral(Number.NaN)).toThrow(/Invalid cypher number literal/)
    expect(() => toCypherLiteral(Number.POSITIVE_INFINITY)).toThrow(
      /Invalid cypher number literal/,
    )
    expect(() => toCypherLiteral({ id: 1 })).toThrow(/Unsupported cypher literal type/)
  })

  it('passes unicode and control characters through literally (valid inside cypher strings)', () => {
    // No backslash/single-quote here — those are covered by the escape-order tests above.
    const input = 'münchen\n\t"é”'
    expect(toCypherLiteral(input)).toBe(`'${input}'`)
  })

  it('renders numeric edge values deterministically', () => {
    expect(toCypherLiteral(0)).toBe('0')
    expect(toCypherLiteral(-0.5)).toBe('-0.5')
    expect(toCypherLiteral(1e21)).toBe('1e+21')
  })
})

describe('renderCypherQuery (hostile input)', () => {
  it('escapes values so injection payloads stay inside the literal', () => {
    const out = renderCypherQuery('MATCH (n {user_id: $user_id, id: $id}) DELETE n', {
      user_id: 'u1',
      id: "t1' DETACH DELETE n //",
    })
    expect(out).toBe("MATCH (n {user_id: 'u1', id: 't1\\' DETACH DELETE n //'}) DELETE n")
  })

  it('throws on missing params instead of substituting undefined', () => {
    expect(() => renderCypherQuery('MATCH (n {id: $missing})', {})).toThrow(
      /Missing cypher parameter/,
    )
  })
})

describe('wrapAgeCypherDollarQuote (hostile escalation)', () => {
  it('escalates the delimiter tag past attacker-controlled content', () => {
    // Build $-sequences via interpolation so no editor/toolchain can mangle the literals.
    const d = '$'
    const tag = (name: string) => `${d}${name}${d}`
    const hostile = `MATCH (n) SET n.x = '${d}${d} ${tag('age_cypher')} ${tag('age_cypher_')}'`
    const wrapped = wrapAgeCypherDollarQuote(hostile)
    // Tag must not collide with any $tag$ sequence present in the payload.
    const expected = tag('age_cypher__')
    expect(wrapped.startsWith(expected)).toBe(true)
    expect(wrapped.endsWith(expected)).toBe(true)
  })
})

