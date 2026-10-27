import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  select: vi.fn(),
  decryptTenantValue: vi.fn(),
  getUserPreferredTimezone: vi.fn(),
}))

/** A drizzle-style chain: every builder step returns itself, awaiting it yields the queued rows. */
function chain(rows: unknown[]) {
  const self: Record<string, unknown> = {}
  for (const step of ['from', 'where', 'orderBy', 'limit']) self[step] = () => self
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return self
}

vi.mock('$lib/server/db', () => ({ getDb: () => ({ select: mocks.select }) }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: mocks.decryptTenantValue,
}))
vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: mocks.getUserPreferredTimezone,
}))

import { loadCaptureAuditInput } from './audit-input'
import { buildCaptureAuditRequest } from './audit-questions'

const thoughtRow = {
  rawText: 'Dentist on Friday at 9, ask Anna for a ride',
  rawTextEncrypted: null,
  normalizedText: 'Dentist on Friday at 9, ask Anna for a ride',
  normalizedTextEncrypted: null,
  createdAt: new Date('2026-11-04T08:15:00.000Z'),
  metadata: {},
  metadataEncrypted: null,
}

const eventRow = {
  semanticSummary: 'Dentist appointment',
  kind: 'appointment',
  activePeriod: '[2026-11-06T08:00:00.000Z,2026-11-06T09:00:00.000Z)',
  timePrecision: 'exact',
  timezone: 'Europe/Berlin',
  isAllDay: false,
  recurrenceRule: null,
  parseMetadata: {},
}

/** The three queries in the order the loader runs them: thought, names, events. */
function queue(thought: unknown[], names: unknown[] = [], events: unknown[] = []) {
  mocks.selectQueue.splice(0, mocks.selectQueue.length, thought, names, events)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.selectQueue.length = 0
  mocks.select.mockImplementation(() => chain(mocks.selectQueue.shift() ?? []))
  mocks.getUserPreferredTimezone.mockResolvedValue('Europe/Berlin')
  mocks.decryptTenantValue.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
  )
})

describe('loadCaptureAuditInput', () => {
  it('builds the audit input from the thought, its mention surfaces and its temporal events', async () => {
    queue([thoughtRow], [{ surface: 'Anna' }], [eventRow])

    const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

    expect(input).toEqual({
      capturedAt: '2026-11-04T08:15:00.000Z',
      timezone: 'Europe/Berlin',
      rawText: 'Dentist on Friday at 9, ask Anna for a ride',
      storedText: 'Dentist on Friday at 9, ask Anna for a ride',
      names: [{ ref: 'n1', surface: 'Anna' }],
      dates: [{ ref: 'd1', event: 'Dentist appointment', day: '2026-11-06', detail: 'at 09:00' }],
      pieces: [],
    })
  })

  it('takes the time zone from the same source enrichment uses for temporal extraction', async () => {
    queue([thoughtRow])
    mocks.getUserPreferredTimezone.mockResolvedValue('America/New_York')

    const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

    expect(mocks.getUserPreferredTimezone).toHaveBeenCalledWith('u1')
    expect(input?.timezone).toBe('America/New_York')
  })

  it('fails loudly when there is no time zone', async () => {
    queue([thoughtRow])
    mocks.getUserPreferredTimezone.mockResolvedValue('  ')
    await expect(loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })).rejects.toThrow(
      /time zone/,
    )
  })

  it('returns null when the thought no longer exists (nothing to audit)', async () => {
    queue([])
    expect(await loadCaptureAuditInput({ userId: 'u1', thoughtId: 'gone' })).toBeNull()
  })

  it('decrypts the raw and the stored text the way enrichment does', async () => {
    queue([
      {
        ...thoughtRow,
        rawText: '',
        rawTextEncrypted: 'enc:what the user typed',
        normalizedText: '',
        normalizedTextEncrypted: 'enc:what Eigen stored',
      },
    ])

    const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

    expect(input?.rawText).toBe('what the user typed')
    expect(input?.storedText).toBe('what Eigen stored')
    expect(mocks.decryptTenantValue).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'thought',
      column: 'raw_text',
      ciphertext: 'enc:what the user typed',
    })
    expect(mocks.decryptTenantValue).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'thought',
      column: 'normalized_text',
      ciphertext: 'enc:what Eigen stored',
    })
  })

  describe('names', () => {
    it('lists the distinct surfaces in the order they were found, with refs n1...', async () => {
      queue(
        [thoughtRow],
        [
          { surface: 'Anna' },
          { surface: 'Kowalski GmbH' },
          { surface: 'Anna' },
          { surface: ' Anna ' },
          { surface: 'anna' },
        ],
      )

      const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

      // Exact repeats are one name; "anna" is a different surface, and whether it is the same name is
      // Jev's question, not a string rule's.
      expect(input?.names).toEqual([
        { ref: 'n1', surface: 'Anna' },
        { ref: 'n2', surface: 'Kowalski GmbH' },
        { ref: 'n3', surface: 'anna' },
      ])
    })

    it('has no names when nothing was found, and skips blank surfaces', async () => {
      queue([thoughtRow], [{ surface: '   ' }])
      expect((await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' }))?.names).toEqual([])
    })
  })

  describe('dates', () => {
    it('gives each temporal event a ref d1... with its day and detail', async () => {
      queue(
        [thoughtRow],
        [],
        [
          eventRow,
          {
            ...eventRow,
            semanticSummary: 'Weekly review',
            kind: 'reminder',
            activePeriod: '[2026-11-03T18:00:00.000Z,2026-11-03T19:00:00.000Z)',
            recurrenceRule: 'FREQ=WEEKLY',
          },
        ],
      )

      const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

      expect(input?.dates).toEqual([
        { ref: 'd1', event: 'Dentist appointment', day: '2026-11-06', detail: 'at 09:00' },
        { ref: 'd2', event: 'Weekly review', day: null, detail: 'every Tuesday at 19:00' },
      ])
    })

    it('has no dates when the capture has no temporal events', async () => {
      queue([thoughtRow])
      expect((await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' }))?.dates).toEqual([])
    })

    it('fails loudly on a recurrence rule it cannot express', async () => {
      queue([thoughtRow], [], [{ ...eventRow, recurrenceRule: 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1' }])
      await expect(loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })).rejects.toThrow(
        /BYSETPOS/,
      )
    })
  })

  describe('pieces', () => {
    const piecesOfFanOut = [
      'Send invoice to Kowalski GmbH',
      'Book train to Hamburg',
      'Water the plants',
    ]

    it('are the texts the capture was split into, for the parent of a multi-task fan-out', async () => {
      queue([{ ...thoughtRow, metadata: { splitInto: piecesOfFanOut } }])

      const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

      expect(input?.pieces).toEqual([
        { ref: 'p1', text: 'Send invoice to Kowalski GmbH' },
        { ref: 'p2', text: 'Book train to Hamburg' },
        { ref: 'p3', text: 'Water the plants' },
      ])
    })

    it('are read from the encrypted metadata the fan-out writes', async () => {
      queue([
        {
          ...thoughtRow,
          metadata: { encrypted: true },
          metadataEncrypted: `enc:${JSON.stringify({ splitInto: piecesOfFanOut, other: 1 })}`,
        },
      ])

      const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

      expect(input?.pieces.map((p) => p.ref)).toEqual(['p1', 'p2', 'p3'])
      expect(mocks.decryptTenantValue).toHaveBeenCalledWith(
        expect.objectContaining({ column: 'metadata' }),
      )
    })

    it('are empty for a child of a split: children get no pieces', async () => {
      queue([{ ...thoughtRow, metadata: { splitFrom: 'parent-id' } }])
      expect((await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' }))?.pieces).toEqual([])
    })

    it('are empty for a capture that was not split', async () => {
      queue([{ ...thoughtRow, metadata: { categorySource: 'decision_model' } }])
      expect((await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' }))?.pieces).toEqual([])
    })

    it('fail loudly when the split marker is not a list of texts', async () => {
      queue([{ ...thoughtRow, metadata: { splitInto: 'Send invoice' } }])
      await expect(loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })).rejects.toThrow(
        /splitInto/,
      )
      queue([{ ...thoughtRow, metadata: { splitInto: ['Send invoice', ''] } }])
      await expect(loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })).rejects.toThrow(
        /splitInto/,
      )
    })
  })

  it('produces an input the audit question builder accepts, one question per part', async () => {
    queue(
      [
        {
          ...thoughtRow,
          metadata: { splitInto: ['Dentist on Friday at 9', 'Ask Anna for a ride'] },
        },
      ],
      [{ surface: 'Anna' }],
      [eventRow],
    )

    const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })
    const request = buildCaptureAuditRequest(input!)

    expect(Object.keys(request.questions)).toEqual([
      'name:n1',
      'missing_names',
      'date:d1',
      'piece:p1',
      'piece:p2',
      'pieces_cover',
    ])
  })
})
