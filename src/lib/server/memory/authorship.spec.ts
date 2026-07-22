import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  USER_AUTHORSHIP,
  authorLayerKeyFromThought,
  authorLayerKeySqlCondition,
  authorshipFromAuthenticatedApiKey,
  resolveAuthorFromPrefix,
  resolveAuthorSqlCondition,
  resolveMcpCaptureAuthorship,
  resolveMemoryAuthorship,
} from './authorship'
import { thought } from '$lib/server/db/schema'

const { getDbMock, selectMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  selectMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

function mockKeyLookup(rows: Array<{ id: string; name: string }>) {
  selectMock.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(async () => rows),
    })),
  })
  getDbMock.mockReturnValue({ select: selectMock })
}

describe('resolveAuthorFromPrefix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user authorship for empty prefix', async () => {
    await expect(resolveAuthorFromPrefix('')).resolves.toEqual(USER_AUTHORSHIP)
    await expect(resolveAuthorFromPrefix('   ')).resolves.toEqual(USER_AUTHORSHIP)
    await expect(resolveAuthorFromPrefix(undefined)).resolves.toEqual(USER_AUTHORSHIP)
  })

  it('returns agent authorship when exactly one key matches', async () => {
    mockKeyLookup([{ id: 'key-1', name: 'cursor' }])
    await expect(resolveAuthorFromPrefix('eigen_abcd')).resolves.toEqual({
      author: 'agent',
      authorLabel: 'cursor',
      authorKeyId: 'key-1',
    })
  })

  it('throws when no key matches', async () => {
    mockKeyLookup([])
    await expect(resolveAuthorFromPrefix('unknown')).rejects.toThrow(/No API key matches/)
  })

  it('throws when multiple keys match', async () => {
    mockKeyLookup([
      { id: 'key-1', name: 'a' },
      { id: 'key-2', name: 'b' },
    ])
    await expect(resolveAuthorFromPrefix('eigen_')).rejects.toThrow(/Ambiguous author prefix/)
  })
})

describe('resolveMemoryAuthorship', () => {
  it('requires authorLabel when author is agent', () => {
    expect(() => resolveMemoryAuthorship({ author: 'agent' })).toThrow(/authorLabel/)
  })

  it('accepts explicit agent authorship', () => {
    expect(
      resolveMemoryAuthorship({
        author: 'agent',
        authorLabel: 'cursor',
        authorKeyId: 'a1111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({
      author: 'agent',
      authorLabel: 'cursor',
      authorKeyId: 'a1111111-1111-4111-8111-111111111111',
    })
  })
})

describe('resolveMcpCaptureAuthorship', () => {
  it('uses Bearer API key identity when no author prefix', async () => {
    await expect(
      resolveMcpCaptureAuthorship({
        authenticatedApiKey: { id: 'key-1', name: 'Cursor' },
      }),
    ).resolves.toEqual({
      author: 'agent',
      authorLabel: 'Cursor',
      authorKeyId: 'key-1',
    })
  })

  it('returns user when as_user is true even with API key auth', async () => {
    await expect(
      resolveMcpCaptureAuthorship({
        asUser: true,
        authenticatedApiKey: { id: 'key-1', name: 'Cursor' },
      }),
    ).resolves.toEqual(USER_AUTHORSHIP)
  })

  it('prefers explicit author prefix over Bearer key', async () => {
    mockKeyLookup([{ id: 'key-2', name: 'bob' }])
    await expect(
      resolveMcpCaptureAuthorship({
        authorPrefix: 'eigen_abcd',
        authenticatedApiKey: { id: 'key-1', name: 'Cursor' },
      }),
    ).resolves.toEqual({
      author: 'agent',
      authorLabel: 'bob',
      authorKeyId: 'key-2',
    })
  })
})

describe('authorshipFromAuthenticatedApiKey', () => {
  it('maps key id and name to agent authorship', () => {
    expect(authorshipFromAuthenticatedApiKey({ id: 'k1', name: 'Cursor' })).toEqual({
      author: 'agent',
      authorLabel: 'Cursor',
      authorKeyId: 'k1',
    })
  })
})

describe('authorLayerKeyFromThought', () => {
  it('returns user for human authorship', () => {
    expect(
      authorLayerKeyFromThought({
        author: 'user',
        authorKeyId: null,
        authorLabel: null,
      }),
    ).toBe('user')
  })

  it('returns apikey id for agent with key', () => {
    expect(
      authorLayerKeyFromThought({
        author: 'agent',
        authorKeyId: 'key-1',
        authorLabel: 'Cursor',
      }),
    ).toBe('apikey:key-1')
  })

  it('falls back to label for legacy agent rows', () => {
    expect(
      authorLayerKeyFromThought({
        author: 'agent',
        authorKeyId: null,
        authorLabel: 'Legacy Agent',
      }),
    ).toBe('label:Legacy Agent')
  })
})

describe('authorLayerKeySqlCondition', () => {
  const cols = {
    author: thought.author,
    authorKeyId: thought.authorKeyId,
    authorLabel: thought.authorLabel,
  }

  it('builds user filter', () => {
    expect(authorLayerKeySqlCondition('user', cols)).toBeDefined()
  })

  it('builds apikey filter', () => {
    expect(authorLayerKeySqlCondition('apikey:key-1', cols)).toBeDefined()
  })

  it('builds label filter for legacy agents', () => {
    expect(authorLayerKeySqlCondition('label:Legacy Agent', cols)).toBeDefined()
  })

  it('resolveAuthorSqlCondition prefers authorLayerKey', () => {
    const sql = resolveAuthorSqlCondition(cols, {
      author: 'user',
      authorLayerKey: 'apikey:key-1',
    })
    expect(sql).toBeDefined()
  })
})
