import { describe, expect, it } from 'vitest'
import { captureDigest, ingestRecordSchema } from './ingest-record'

const item = (rawText: string, day: number) => ({
  rawText,
  capturedAt: new Date(Date.UTC(2025, 0, 1 + day)),
})

describe('captureDigest', () => {
  it('is stable for the same captures and a sha256 hex string', () => {
    const a = captureDigest([item('a', 0), item('b', 1)])
    expect(a).toBe(captureDigest([item('a', 0), item('b', 1)]))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes with the text, the order, the capture time and the count', () => {
    const base = captureDigest([item('a', 0), item('b', 1)])
    expect(captureDigest([item('a', 0), item('c', 1)])).not.toBe(base)
    expect(captureDigest([item('b', 0), item('a', 1)])).not.toBe(base)
    expect(captureDigest([item('a', 0), item('b', 2)])).not.toBe(base)
    expect(captureDigest([item('a', 0)])).not.toBe(base)
  })

  it('does not confuse two captures with one that holds both texts', () => {
    expect(captureDigest([item('ab', 0)])).not.toBe(captureDigest([item('a', 0), item('b', 0)]))
  })
})

describe('ingestRecordSchema', () => {
  const record = {
    personaId: 7,
    tenantUserId: 't7',
    captures: 2,
    captureDigest: 'a'.repeat(64),
    thoughtIds: ['x', 'y'],
    thoughtCount: 3,
    usd: 0.1,
    ms: 5,
  }

  it('accepts a complete record', () => {
    expect(ingestRecordSchema.parse(record)).toEqual(record)
  })

  it.each(['captureDigest', 'thoughtIds', 'thoughtCount'])(
    'a record without %s is invalid',
    (key) => {
      const { [key as keyof typeof record]: _dropped, ...rest } = record
      expect(ingestRecordSchema.safeParse(rest).success).toBe(false)
    },
  )

  it('rejects a digest that is not 64 hex characters and blank thought ids', () => {
    expect(ingestRecordSchema.safeParse({ ...record, captureDigest: 'abc' }).success).toBe(false)
    expect(ingestRecordSchema.safeParse({ ...record, thoughtIds: ['x', ' '] }).success).toBe(false)
  })
})
