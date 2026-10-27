import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  /** The `where` argument of every select, in call order: thought, surfaces, project links, events. */
  wheres: [] as unknown[],
  select: vi.fn(),
  decryptTenantValue: vi.fn(),
  getUserPreferredTimezone: vi.fn(),
}))

/** A drizzle-style chain: every builder step returns itself, awaiting it yields the queued rows. */
function chain(rows: unknown[]) {
  const self: Record<string, unknown> = {}
  for (const step of ['from', 'innerJoin', 'orderBy', 'limit']) self[step] = () => self
  self.where = (condition: unknown) => {
    mocks.wheres.push(condition)
    return self
  }
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

/**
 * The queries in the order the loader runs them: thought, mention surfaces, project links, events.
 * `projects` are the labels of the project entities the thought is linked to.
 */
function queue(
  thought: unknown[],
  names: unknown[] = [],
  events: unknown[] = [],
  projects: unknown[] = [],
) {
  mocks.selectQueue.splice(0, mocks.selectQueue.length, thought, names, projects, events)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.selectQueue.length = 0
  mocks.wheres.length = 0
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

    describe('project names', () => {
      // A project mention leaves no entity_resolution_log row; the project the capture is linked to
      // is persisted as a thought_entity link to a project entity.
      it('adds the canonical label of a project the thought is linked to, after the logged surfaces', async () => {
        queue([thoughtRow], [{ surface: 'Priya' }], [], [{ label: 'Eigen' }])

        const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

        expect(input?.names).toEqual([
          { ref: 'n1', surface: 'Priya' },
          { ref: 'n2', surface: 'Eigen' },
        ])
      })

      it('names a project even when the capture logged no surface at all', async () => {
        queue([thoughtRow], [], [], [{ label: 'Eigen' }])
        expect((await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' }))?.names).toEqual([
          { ref: 'n1', surface: 'Eigen' },
        ])
      })

      it('does not repeat a project label that is also a logged surface (same trimmed string)', async () => {
        queue(
          [thoughtRow],
          [{ surface: 'Eigen' }, { surface: 'Priya' }],
          [],
          [{ label: ' Eigen ' }],
        )

        const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

        expect(input?.names).toEqual([
          { ref: 'n1', surface: 'Eigen' },
          { ref: 'n2', surface: 'Priya' },
        ])
      })

      it('does not repeat a project label linked twice, and keeps the order the links were made in', async () => {
        queue(
          [thoughtRow],
          [{ surface: 'Anna' }],
          [],
          [{ label: 'Eigen' }, { label: 'Launch' }, { label: 'Eigen' }, { label: '  ' }],
        )

        const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

        expect(input?.names).toEqual([
          { ref: 'n1', surface: 'Anna' },
          { ref: 'n2', surface: 'Eigen' },
          { ref: 'n3', surface: 'Launch' },
        ])
      })

      it("treats a different spelling as a different name: whether it is the same is Jev's question", async () => {
        queue([thoughtRow], [{ surface: 'eigen' }], [], [{ label: 'Eigen' }])
        const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })
        expect(input?.names.map((n) => n.surface)).toEqual(['eigen', 'Eigen'])
      })

      it("looks only at this thought's links to project entities, of any link source", async () => {
        queue([thoughtRow], [], [], [{ label: 'Eigen' }])
        await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })

        // 3rd select = project links (thought, surfaces, project links, events)
        const dialect = new PgDialect()
        const projectWhere = mocks.wheres[2] as Parameters<PgDialect['sqlToQuery']>[0]
        const { sql: text, params } = dialect.sqlToQuery(projectWhere)
        expect(text).toMatch(/"thought_entity"\."user_id" = \$\d/)
        expect(text).toMatch(/"thought_entity"\."thought_id" = \$\d/)
        expect(text).toMatch(/"canonical_entity"\."entity_type" = \$\d/)
        expect(text).toMatch(/"canonical_entity"\."project_status" is not null/)
        expect(params).toEqual(['u1', 't1', 'project'])
        // no filter on the link source: a mention, the enrich LLM's decision or the user's pick all count
        expect(text).not.toMatch(/"source"/)
      })

      it('feeds the audit questions a name question for the project', async () => {
        queue([thoughtRow], [], [], [{ label: 'Eigen' }])
        const input = await loadCaptureAuditInput({ userId: 'u1', thoughtId: 't1' })
        expect(Object.keys(buildCaptureAuditRequest(input!).questions)).toContain('name:n1')
      })
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
      'missing_dates',
      'piece:p1',
      'piece:p2',
      'pieces_cover',
    ])
  })
})
