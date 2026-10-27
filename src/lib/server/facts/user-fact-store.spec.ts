import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  state: { db: null as unknown },
  ciphertexts: new Map<string, string>(),
  searchMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: () => m.state.db }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  // opaque on purpose: a leaked plaintext cannot hide inside "enc(<plaintext>)"
  encryptTenantValue: vi.fn(async (input: { table: string; column: string; plaintext: string }) => {
    const cipher = `cipher-${m.ciphertexts.size + 1}`
    m.ciphertexts.set(cipher, `${input.table}.${input.column}:${input.plaintext}`)
    return cipher
  }),
  decryptTenantValue: vi.fn(),
}))
vi.mock('./search-user-facts', () => ({ searchUserFacts: m.searchMock }))

import type { FactWritePlan, PlannedFact } from './plan-fact-writes'
import { userFact, userFactSource, userSecureValue } from '$lib/server/db/schema'
import { createRecordingDb } from '$lib/test/recording-db'
import { SECURE_VALUE_PLACEHOLDER, secureReferenceToken } from './fact-vocabulary'
import {
  FACT_NEAREST_PER_CANDIDATE,
  loadKnownPeople,
  loadNearestFacts,
  persistFactWrites,
} from './user-fact-store'

const THOUGHT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW_ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID_2 = '33333333-3333-4333-8333-333333333333'
const SECURE_ID = '22222222-2222-4222-8222-222222222222'
const OLD_ID = '99999999-9999-4999-8999-999999999999'
const AT = new Date('2026-06-02T08:30:00.000Z')
const VECTOR = [0.1, 0.2, 0.3]
const PLATE = 'B-XY 4711'

const planned = (over: Partial<PlannedFact> = {}): PlannedFact => ({
  id: NEW_ID,
  subject: { kind: 'user' },
  kind: 'activity',
  displayStatement: 'Swims at the local pool',
  storedStatement: 'Swims at the local pool',
  lexicalText: 'swims at the local pool',
  confidence: 0.92,
  inferred: false,
  secureValue: null,
  supersedesFactId: null,
  ...over,
})

/** Everything the code wrote, as text (tables are Drizzle objects and stay out of it). */
const written = (events: Array<Record<string, unknown>>) =>
  JSON.stringify(events.map((e) => ({ ...e, table: undefined })))

const write = (plan: FactWritePlan, over: { textFileId?: string | null } = {}) =>
  persistFactWrites('u1', {
    plan,
    embeddings: plan.adds.map(() => VECTOR),
    thoughtId: THOUGHT,
    textFileId: over.textFileId ?? null,
    capturedAt: AT,
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.ciphertexts.clear()
})

describe('persistFactWrites', () => {
  it('inserts the fact with an encrypted statement, its embedding and as-of, and links the source thought', async () => {
    const rec = createRecordingDb()
    m.state.db = rec.db

    const counts = await write({ adds: [planned()], confirms: [] })

    expect(counts).toEqual({ added: 1, superseded: 0, confirmed: 0 })
    const factInsert = rec.events.find((e) => e.kind === 'insert' && e.table === userFact)
    expect(factInsert).toMatchObject({
      values: [
        {
          id: NEW_ID,
          userId: 'u1',
          subjectKind: 'user',
          subjectLabel: null,
          subjectEntityId: null,
          statementEncrypted: 'cipher-1',
          lexicalText: 'swims at the local pool',
          embedding: VECTOR,
          kind: 'activity',
          confidence: 0.92,
          inferred: false,
          status: 'active',
          asOf: AT,
          secureValueId: null,
        },
      ],
    })
    expect(m.ciphertexts.get('cipher-1')).toBe('user_fact.statement:Swims at the local pool')
    // the plaintext statement is never a column value
    expect(written([factInsert!])).not.toContain('Swims at the local pool')
    expect(rec.events.find((e) => e.kind === 'insert' && e.table === userFactSource)).toMatchObject(
      {
        values: [{ userId: 'u1', factId: NEW_ID, thoughtId: THOUGHT, textFileId: null }],
      },
    )
  })

  it('records the reference note as a source when the extractor was given its text', async () => {
    const rec = createRecordingDb()
    m.state.db = rec.db
    await write({ adds: [planned()], confirms: [] }, { textFileId: FILE })
    expect(rec.events.find((e) => e.kind === 'insert' && e.table === userFactSource)).toMatchObject(
      {
        values: [{ factId: NEW_ID, thoughtId: THOUGHT, textFileId: FILE }],
      },
    )
  })

  it('a person fact keeps the label as written and the entity link', async () => {
    const rec = createRecordingDb()
    m.state.db = rec.db
    await write({
      adds: [
        planned({
          subject: { kind: 'person', label: 'Mia (friend)', entityId: OLD_ID },
          kind: 'health',
        }),
      ],
      confirms: [],
    })
    const factInsert = rec.events.find((e) => e.kind === 'insert' && e.table === userFact)
    expect(factInsert).toMatchObject({
      values: [{ subjectKind: 'person', subjectLabel: 'Mia (friend)', subjectEntityId: OLD_ID }],
    })
  })

  describe('identifier facts (Q3)', () => {
    const plate = planned({
      kind: 'circumstance',
      displayStatement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
      storedStatement: `The user's licence plate is ${secureReferenceToken(SECURE_ID)}`,
      lexicalText: "the user's licence plate is [secure value]",
      secureValue: { id: SECURE_ID, kind: 'licence_plate', label: 'licence plate', value: PLATE },
    })

    it('stores the value only encrypted in user_secure_value, before the fact that references it', async () => {
      const rec = createRecordingDb()
      m.state.db = rec.db
      await write({ adds: [plate], confirms: [] })

      const inserts = rec.events.filter((e) => e.kind === 'insert')
      expect(inserts.map((e) => (e.kind === 'insert' ? e.table : null))).toEqual([
        userSecureValue,
        userFact,
        userFactSource,
      ])
      const secureInsert = inserts[0]
      expect(secureInsert).toMatchObject({
        values: [{ id: SECURE_ID, userId: 'u1', kind: 'licence_plate', label: 'licence plate' }],
      })
      const encryptedValue = (secureInsert as { values: Array<{ valueEncrypted: string }> })
        .values[0]!.valueEncrypted
      expect(m.ciphertexts.get(encryptedValue)).toBe(`user_secure_value.value:${PLATE}`)
      expect(inserts[1]).toMatchObject({ values: [{ id: NEW_ID, secureValueId: SECURE_ID }] })
    })

    it('the value appears in no inserted column of any table, and not in what is embedded or indexed', async () => {
      const rec = createRecordingDb()
      m.state.db = rec.db
      await write({ adds: [plate], confirms: [] })
      expect(written(rec.events)).not.toContain(PLATE)
      // the statement that was encrypted holds the reference, not the value
      const statementPlain = [...m.ciphertexts.values()].find((v) =>
        v.startsWith('user_fact.statement:'),
      )
      expect(statementPlain).toContain(secureReferenceToken(SECURE_ID))
      expect(statementPlain).not.toContain(PLATE)
    })
  })

  it('an update inserts the new fact, then marks the stored one superseded by it', async () => {
    const rec = createRecordingDb()
    m.state.db = rec.db
    const counts = await write({
      adds: [
        planned({
          displayStatement: 'Quit coffee',
          storedStatement: 'Quit coffee',
          supersedesFactId: OLD_ID,
        }),
      ],
      confirms: [],
    })
    expect(counts).toEqual({ added: 1, superseded: 1, confirmed: 0 })
    const insertAt = rec.events.findIndex((e) => e.kind === 'insert' && e.table === userFact)
    const updateAt = rec.events.findIndex((e) => e.kind === 'update' && e.table === userFact)
    expect(insertAt).toBeGreaterThanOrEqual(0)
    expect(updateAt).toBeGreaterThan(insertAt)
    expect(rec.events[updateAt]).toMatchObject({
      set: { status: 'superseded', supersededBy: NEW_ID },
    })
  })

  describe('confirm', () => {
    it('adds this thought as a source and moves as-of forward, never backwards', async () => {
      // the stored fact is newer than this (backdated) capture: as-of stays
      const rec = createRecordingDb([[{ asOf: new Date('2026-07-01T00:00:00Z') }]])
      m.state.db = rec.db
      const counts = await write({ adds: [], confirms: [OLD_ID] })
      expect(counts).toEqual({ added: 0, superseded: 0, confirmed: 1 })
      const source = rec.events.find((e) => e.kind === 'insert' && e.table === userFactSource)
      expect(source).toMatchObject({
        values: { factId: OLD_ID, thoughtId: THOUGHT },
        onConflictDoNothing: true,
      })
      expect(rec.events.some((e) => e.kind === 'update' && e.table === userFact)).toBe(false)
    })

    it('moves as-of to the capture time when the capture is newer', async () => {
      const rec = createRecordingDb([[{ asOf: new Date('2026-05-01T00:00:00Z') }]])
      m.state.db = rec.db
      await write({ adds: [], confirms: [OLD_ID] })
      expect(rec.events.find((e) => e.kind === 'update' && e.table === userFact)).toMatchObject({
        set: { asOf: AT },
      })
    })

    it('skips a stored fact that is no longer active', async () => {
      const rec = createRecordingDb([[]])
      m.state.db = rec.db
      const counts = await write({ adds: [], confirms: [OLD_ID] })
      expect(counts.confirmed).toBe(0)
      expect(rec.events.some((e) => e.kind === 'insert')).toBe(false)
    })
  })

  it('refuses embeddings that do not line up with the facts to write', async () => {
    m.state.db = createRecordingDb().db
    await expect(
      persistFactWrites('u1', {
        plan: { adds: [planned(), planned({ id: NEW_ID_2 })], confirms: [] },
        embeddings: [VECTOR],
        thoughtId: THOUGHT,
        textFileId: null,
        capturedAt: AT,
      }),
    ).rejects.toThrow(/embedding/)
  })
})

describe('loadKnownPeople', () => {
  it('lists the entities linked to the thought as {id, label, entityType}', async () => {
    const rec = createRecordingDb([[{ id: 'e1', label: 'Mia', entityType: 'person' }]])
    m.state.db = rec.db
    await expect(loadKnownPeople('u1', THOUGHT)).resolves.toEqual([
      { id: 'e1', label: 'Mia', entityType: 'person' },
    ])
  })
})

describe('loadNearestFacts', () => {
  it('finds the active facts nearest to one candidate statement by meaning, with the candidate\'s own embedding', async () => {
    m.searchMock.mockResolvedValue([
      {
        id: OLD_ID,
        subjectKind: 'user',
        subjectLabel: null,
        statement: 'Drinks three coffees a day',
        kind: 'habit',
        inferred: false,
        asOf: AT,
        score: 0.8,
      },
    ])
    const out = await loadNearestFacts('u1', {
      text: 'I quit coffee',
      queryEmbedding: VECTOR,
    })
    expect(m.searchMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        query: 'I quit coffee',
        queryEmbedding: VECTOR,
        topK: FACT_NEAREST_PER_CANDIDATE,
      }),
    )
    // history never reconciles: only active facts are offered
    expect(m.searchMock.mock.calls[0]![1].includeSuperseded).toBeUndefined()
    expect(out).toEqual([
      {
        id: OLD_ID,
        subjectKind: 'user',
        subjectLabel: null,
        kind: 'habit',
        statement: 'Drinks three coffees a day',
        inferred: false,
        asOf: AT,
      },
    ])
  })
})
