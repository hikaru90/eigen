import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ state: { db: null as unknown } }))

vi.mock('$lib/server/db', () => ({ getDb: () => m.state.db }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.replace(/^cipher:/, ''),
  ),
}))

import { createRecordingDb } from '$lib/test/recording-db'
import { secureReferenceToken } from './fact-vocabulary'
import { substituteSecureReferences } from './secure-values'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

beforeEach(() => vi.clearAllMocks())

describe('substituteSecureReferences (server-side, after generation)', () => {
  it('replaces each reference token with the decrypted value and reports how many', async () => {
    const rec = createRecordingDb([
      [
        { id: ID1, valueEncrypted: 'cipher:B-XY 4711' },
        { id: ID2, valueEncrypted: 'cipher:mia@example.com' },
      ],
    ])
    m.state.db = rec.db

    const out = await substituteSecureReferences(
      'u1',
      `Your plate is ${secureReferenceToken(ID1)} and Mia's mail is ${secureReferenceToken(ID2)}. Again: ${secureReferenceToken(ID1)}`,
    )

    expect(out).toEqual({
      text: "Your plate is B-XY 4711 and Mia's mail is mia@example.com. Again: B-XY 4711",
      substituted: 3,
      unresolved: [],
    })
    // one lookup for both distinct ids
    expect(rec.events.filter((e) => e.kind === 'select')).toHaveLength(1)
  })

  it('leaves a reference whose value is gone (forgotten) untouched and reports it instead of guessing', async () => {
    m.state.db = createRecordingDb([[{ id: ID1, valueEncrypted: 'cipher:B-XY 4711' }]]).db
    const out = await substituteSecureReferences(
      'u1',
      `${secureReferenceToken(ID1)} / ${secureReferenceToken(ID2)}`,
    )
    expect(out.text).toBe(`B-XY 4711 / ${secureReferenceToken(ID2)}`)
    expect(out.unresolved).toEqual([ID2])
    expect(out.substituted).toBe(1)
  })

  it('a text without references costs no query', async () => {
    const rec = createRecordingDb()
    m.state.db = rec.db
    expect(await substituteSecureReferences('u1', 'No identifiers here')).toEqual({
      text: 'No identifiers here',
      substituted: 0,
      unresolved: [],
    })
    expect(rec.events).toEqual([])
  })

  it('matches the id case-insensitively', async () => {
    m.state.db = createRecordingDb([[{ id: ID1, valueEncrypted: 'cipher:X' }]]).db
    const out = await substituteSecureReferences('u1', `[secure:${ID1.toUpperCase()}]`)
    expect(out.text).toBe('X')
  })
})
